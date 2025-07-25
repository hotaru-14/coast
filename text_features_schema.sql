-- テキスト機能用のデータベーススキーマ
-- ユーザープロファイルとコメント機能を追加

-- 必要な拡張機能の確認
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ユーザープロファイルテーブル
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  display_name text,
  avatar_url text
);

-- 2. 訪問コメントテーブル
CREATE TABLE IF NOT EXISTS public.visit_comments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  title text,
  content text,
  
  -- 1つの訪問につき1つのコメント
  UNIQUE(visit_id)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS visit_comments_visit_id_idx ON public.visit_comments (visit_id);

-- RLS設定
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_comments ENABLE ROW LEVEL SECURITY;

-- ユーザープロファイルのRLSポリシー
DROP POLICY IF EXISTS "Users manage own profile" ON public.user_profiles;
CREATE POLICY "Users manage own profile" ON public.user_profiles 
FOR ALL USING (auth.uid() = id);

-- コメントのRLSポリシー
DROP POLICY IF EXISTS "Visit owner manages comments" ON public.visit_comments;
CREATE POLICY "Visit owner manages comments" ON public.visit_comments 
FOR ALL USING (visit_id IN (SELECT id FROM visits WHERE user_id = auth.uid()));

-- updated_atを自動更新するトリガー関数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- user_profilesのupdated_atトリガー
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- visit_commentsのupdated_atトリガー
DROP TRIGGER IF EXISTS update_visit_comments_updated_at ON public.visit_comments;
CREATE TRIGGER update_visit_comments_updated_at
    BEFORE UPDATE ON public.visit_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();