import { createClient } from '@supabase/supabase-js';

// 環境変数からSupabaseの設定を取得
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Supabaseクライアントを作成
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // 永続的なセッションを有効にする
    persistSession: true,
    // セッションストレージの設定
    storage: window.localStorage,
  },
});

// デバッグ用: Supabase接続状態をログ出力
console.log('🌊 Supabase client initialized');
console.log('URL:', supabaseUrl);
console.log('Using anon key:', supabaseAnonKey.substring(0, 20) + '...'); 