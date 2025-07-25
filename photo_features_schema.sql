-- 写真機能用のデータベーススキーマ
-- 訪問写真とStorage設定を追加

-- 必要な拡張機能の確認
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. 訪問写真テーブル
CREATE TABLE IF NOT EXISTS public.visit_photos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamptz NOT NULL DEFAULT now(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  
  -- Supabase Storage情報
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes integer,
  mime_type text,
  
  -- メイン写真フラグ（1つの訪問につき1つのメイン写真）
  is_primary boolean DEFAULT false,
  
  -- 画像メタデータ
  width integer,
  height integer,
  
  -- ソート順序（ユーザーが並び替え可能）
  sort_order integer DEFAULT 0
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS visit_photos_visit_id_idx ON public.visit_photos (visit_id, sort_order);
CREATE INDEX IF NOT EXISTS visit_photos_primary_idx ON public.visit_photos (visit_id, is_primary) WHERE is_primary = true;

-- RLS設定
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;

-- 写真のRLSポリシー
DROP POLICY IF EXISTS "Visit owner manages photos" ON public.visit_photos;
CREATE POLICY "Visit owner manages photos" ON public.visit_photos 
FOR ALL USING (visit_id IN (SELECT id FROM visits WHERE user_id = auth.uid()));

-- メイン写真制約を保証するトリガー関数
CREATE OR REPLACE FUNCTION ensure_single_primary_photo()
RETURNS TRIGGER AS $$
BEGIN
    -- 新しい写真をメイン写真に設定する場合、他のメイン写真を解除
    IF NEW.is_primary = true THEN
        UPDATE public.visit_photos 
        SET is_primary = false 
        WHERE visit_id = NEW.visit_id 
        AND id != NEW.id 
        AND is_primary = true;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成
DROP TRIGGER IF EXISTS ensure_single_primary_photo_trigger ON public.visit_photos;
CREATE TRIGGER ensure_single_primary_photo_trigger
    BEFORE INSERT OR UPDATE ON public.visit_photos
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_photo();

-- === Supabase Storage設定 ===

-- 写真用バケット作成（既に存在する場合はエラーを無視）
DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public) 
    VALUES ('visit-photos', 'visit-photos', false);
EXCEPTION WHEN unique_violation THEN
    -- バケットが既に存在する場合は何もしない
    NULL;
END $$;

-- Storage RLS ポリシー

-- ユーザーが自分の写真をアップロード
DROP POLICY IF EXISTS "Users upload own photos" ON storage.objects;
CREATE POLICY "Users upload own photos" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'visit-photos' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- ユーザーが自分の写真にアクセス
DROP POLICY IF EXISTS "Users access own photos" ON storage.objects;
CREATE POLICY "Users access own photos" ON storage.objects
FOR SELECT USING (
  bucket_id = 'visit-photos' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- ユーザーが自分の写真を更新
DROP POLICY IF EXISTS "Users update own photos" ON storage.objects;
CREATE POLICY "Users update own photos" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'visit-photos' AND 
  (storage.foldername(name))[1] = auth.uid()::text
) WITH CHECK (
  bucket_id = 'visit-photos' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- ユーザーが自分の写真を削除
DROP POLICY IF EXISTS "Users delete own photos" ON storage.objects;
CREATE POLICY "Users delete own photos" ON storage.objects
FOR DELETE USING (
  bucket_id = 'visit-photos' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- === 便利なビュー ===

-- 訪問に写真情報を含めたビュー
CREATE OR REPLACE VIEW public.visits_with_photos AS
SELECT 
    v.*,
    COALESCE(
        json_agg(
            json_build_object(
                'id', p.id,
                'storage_path', p.storage_path,
                'file_name', p.file_name,
                'is_primary', p.is_primary,
                'sort_order', p.sort_order,
                'created_at', p.created_at
            ) ORDER BY p.sort_order, p.created_at
        ) FILTER (WHERE p.id IS NOT NULL),
        '[]'::json
    ) as photos,
    -- メイン写真の情報
    primary_photo.storage_path as primary_photo_path,
    primary_photo.file_name as primary_photo_name
FROM public.visits v
LEFT JOIN public.visit_photos p ON v.id = p.visit_id
LEFT JOIN public.visit_photos primary_photo ON v.id = primary_photo.visit_id AND primary_photo.is_primary = true
GROUP BY v.id, primary_photo.storage_path, primary_photo.file_name;

-- RLSをビューにも適用
ALTER VIEW public.visits_with_photos OWNER TO postgres;

-- === 統計情報用の関数 ===

-- ユーザーの写真統計を取得する関数
CREATE OR REPLACE FUNCTION get_user_photo_stats(user_uuid uuid)
RETURNS json
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'total_photos', COUNT(*),
        'total_size_bytes', COALESCE(SUM(file_size_bytes), 0),
        'visits_with_photos', COUNT(DISTINCT visit_id)
    ) INTO result
    FROM public.visit_photos p
    JOIN public.visits v ON p.visit_id = v.id
    WHERE v.user_id = user_uuid;
    
    RETURN result;
END;
$$;