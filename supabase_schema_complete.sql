-- =================================================================
-- Supabase PWA Project: Complete Database Schema Setup
--
-- このスクリプトをSupabaseのSQL Editorで一度実行するだけで、
-- 必要な拡張機能、テーブル、セキュリティポリシー、関数がすべて設定されます。
-- =================================================================

-- ========= 0. 必要な拡張機能を有効化 =========
-- PostGIS拡張（地理空間データ処理用）
CREATE EXTENSION IF NOT EXISTS postgis;

-- UUID生成用拡張
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========= 1. 海岸線セグメントのテーブル (`coastline_segments`) =========
-- GeoJSONからインポートした海岸線の地理空間データを格納します。

CREATE TABLE public.coastline_segments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- SVGの<path>要素のIDと一致させるための、アプリケーション固有のID
  svg_id text UNIQUE NOT NULL,
  name text,
  -- PostGISのジオメトリ型。LineString(線)ジオメトリ、SRID 4326 (WGS84) を指定
  geom geometry(LineString, 4326) NOT NULL
);

-- パフォーマンス向上のため、位置情報検索を高速化する空間インデックスを作成 (必須)
CREATE INDEX coastline_segments_geom_idx
ON public.coastline_segments
USING GIST (geom);

-- セキュリティ設定: RLS (行単位セキュリティ) を有効化
ALTER TABLE public.coastline_segments ENABLE ROW LEVEL SECURITY;

-- セキュリティポリシー: このテーブルは公開情報とし、誰でも読み取りを許可する
CREATE POLICY "Allow public read access for coastline_segments"
ON public.coastline_segments
FOR SELECT USING (true);


-- ========= 2. 訪問履歴のテーブル (`visits`) =========
-- ユーザーがどの海岸線を訪れたかを記録します。

CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  visited_at timestamptz NOT NULL DEFAULT now(),
  -- `auth.users`テーブルの`id`を参照する外部キー
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- `coastline_segments`テーブルの`id`を参照する外部キー
  coastline_id uuid NOT NULL REFERENCES public.coastline_segments(id) ON DELETE CASCADE,
  -- 同じユーザーが同じ場所に複数回登録できないようにUNIQUE制約を設ける
  UNIQUE(user_id, coastline_id)
);

-- セキュリティ設定: RLS (行単位セキュリティ) を有効化
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

-- セキュリティポリシー: 自分の訪問履歴のみを読み取れる
CREATE POLICY "Allow individual read access for visits"
ON public.visits
FOR SELECT USING (auth.uid() = user_id);

-- セキュリティポリシー: 自分の訪問履歴のみを登録できる
CREATE POLICY "Allow individual insert for visits"
ON public.visits
FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ========= 3. コアロジックとなるSQL関数 (`register_visit_if_near`) =========
-- ユーザーの現在地が海岸線から500m以内であれば、訪問履歴を自動で登録します。
-- この関数をフロントエンドからRPCとして呼び出します。

CREATE OR REPLACE FUNCTION public.register_visit_if_near(lat float, lng float)
RETURNS json
-- SECURITY DEFINER: この関数は、呼び出したユーザーではなく「関数の作成者(管理者)」の権限で実行されます。
-- これにより、ユーザーにテーブルへの直接の書き込み権限を与えずに、安全にデータを登録できます。
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    nearest_coastline record;
    distance float;
    result json;
    -- request.jwt.claimsから'sub'（ユーザーID）を取得します。
    -- これにより、現在認証されているユーザーのIDを安全に取得できます。
    current_user_id uuid := (auth.jwt() ->> 'sub')::uuid;
BEGIN
    -- 1. 最も近い海岸線セグメントを検索
    SELECT * INTO nearest_coastline
    FROM public.coastline_segments
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    LIMIT 1;

    -- 2. その海岸線との距離をメートル単位で計算
    distance := ST_Distance(
        nearest_coastline.geom::geography,
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    );

    -- 3. 距離が500m以内か判定
    IF distance <= 500 THEN
        -- 4. 500m以内なら、visitsテーブルにINSERTを試みる
        -- ON CONFLICT DO NOTHINGにより、既に訪問済みの場合もエラーになりません。
        INSERT INTO public.visits (user_id, coastline_id)
        VALUES (current_user_id, nearest_coastline.id)
        ON CONFLICT (user_id, coastline_id) DO NOTHING;
        
        result := json_build_object('success', true, 'message', '訪問を記録しました！', 'distance', distance);
    ELSE
        result := json_build_object('success', false, 'message', '海岸線から500m以上離れています。', 'distance', distance);
    END IF;

    RETURN result;
END;
$$;

-- =================================================================
-- Setup Complete!
-- ================================================================= 