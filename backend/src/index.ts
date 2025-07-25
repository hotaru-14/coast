import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';

// 環境変数を読み込み
dotenv.config();

// 環境変数からSupabaseの情報を取得
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Honoの型定義を拡張して、コンテキストにSupabaseクライアントを追加できるようにする
type AppContext = {
  Variables: {
    supabase: SupabaseClient;
  };
};

// Honoアプリケーションを初期化
const app = new Hono<AppContext>();

// --- ミドルウェア ---

// 1. CORS (Cross-Origin Resource Sharing) の設定
// フロントエンドのドメインからのリクエストを許可します
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'], // 複数のポートに対応
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  credentials: true,
}));

// 2. Supabaseクライアントを初期化するミドルウェア
// 各リクエストのAuthorizationヘッダーからJWTトークンを取得し、
// そのユーザーとして認証されたSupabaseクライアントを作成します。
app.use('/api/*', async (c, next) => {
  // Authorizationヘッダーからトークンを取得 (例: "Bearer <token>")
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.split(' ')[1];

  // ユーザーごとのクライアントを作成
  // トークンがない場合でも、anonキーで初期化されたクライアントが作成される
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: token ? {
        Authorization: `Bearer ${token}`,
      } : {},
    },
  });
  
  // 作成したクライアントをコンテキストにセットして、後続の処理で使えるようにする
  c.set('supabase', supabase);
  await next();
});

// --- APIエンドポイント ---

// GET /api/visits - 認証されたユーザーの訪問履歴を取得する
app.get('/api/visits', async (c) => {
  const supabase = c.get('supabase');

  try {
    // 新しいスキーマに対応した訪問履歴の取得
    // RLS（Row Level Security）により、認証されたユーザーの履歴のみが取得される
    const { data, error } = await supabase
      .from('visits')
      .select(`
        id,
        visited_at,
        coastline_segments (
          svg_id,
          name,
          geom
        )
      `)
      .order('visited_at', { ascending: false });

    if (error) {
      console.error('Error fetching visits:', error);
      return c.json({ error: error.message }, 500);
    }

    // フロントエンドで扱いやすいようにデータを整形
    const visitsWithGeometry = data.map((v: any) => ({
      id: v.id,
      visitedAt: v.visited_at,
      coastline: {
        id: v.coastline_segments?.svg_id,
        name: v.coastline_segments?.name,
        geometry: v.coastline_segments?.geom
      }
    })).filter(v => v.coastline.id);

    const visitedIds = visitsWithGeometry.map(v => v.coastline.id);

    return c.json({ 
      visitedIds,
      visitsWithGeometry 
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/register-visit - 現在地に近い海岸線の訪問を登録する
app.post('/api/register-visit', async (c) => {
  const supabase = c.get('supabase');
  
  try {
    // リクエストボディから緯度経度を取得
    const { lat, lng } = await c.req.json();

    if (!lat || !lng) {
      return c.json({ error: 'Latitude and longitude are required' }, 400);
    }

    // 数値検証
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      return c.json({ error: 'Invalid latitude or longitude format' }, 400);
    }

    // 範囲検証
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return c.json({ error: 'Latitude or longitude out of valid range' }, 400);
    }

    // 新しいPostGIS対応のRPC関数を呼び出す
    // 新しい関数は500m以内の海岸線を検索し、重複登録を自動的に防ぐ
    const { data, error } = await supabase.rpc('register_visit_if_near', {
      lat: latitude,
      lng: longitude,
    });

    if (error) {
      console.error('Error calling RPC:', error);
      // 認証エラーの場合は適切なステータスコードを返す
      if (error.message.includes('permission denied') || error.message.includes('RLS')) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      return c.json({ error: error.message }, 500);
    }

    // 成功時に海岸線の詳細情報も取得して返す
    if (data && data.success && data.coastline_id) {
      // 訪問した海岸線の詳細情報を取得
      const { data: coastlineData, error: coastlineError } = await supabase
        .from('coastline_segments')
        .select('svg_id, name, geom')
        .eq('id', data.coastline_id)
        .single();

      if (!coastlineError && coastlineData) {
        return c.json({
          ...data,
          coastline: {
            id: coastlineData.svg_id,
            name: coastlineData.name,
            geometry: coastlineData.geom
          }
        });
      }
    }

    // 失敗時またはエラー時は元のデータをそのまま返す
    return c.json(data);

  } catch (err) {
    console.error('Unexpected error in register-visit:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/coastlines - 海岸線データを取得する（地図表示用）
app.get('/api/coastlines', async (c) => {
  const supabase = c.get('supabase');
  
  try {
    // すべての海岸線セグメントを取得
    const { data, error } = await supabase
      .from('coastline_segments')
      .select('svg_id, name, geom')
      .order('svg_id')
      .limit(2000);

    if (error) {
      console.error('Error fetching coastlines:', error);
      return c.json({ error: error.message }, 500);
    }

    // フロントエンドで扱いやすい形式に変換
    const coastlines = data.map((segment: any) => ({
      id: segment.svg_id,
      name: segment.name,
      geometry: segment.geom  // PostGIS WKT文字列として返す
    }));

    return c.json({ coastlines });
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ヘルスチェック用エンドポイント
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    message: 'Coast API is running!',
    schema: 'PostGIS-enabled',
    distance_limit: '500m'
  });
});

// サーバーを起動
const port = Number(process.env.PORT) || 3000;

console.log(`🌊 Coast API Server (PostGIS) starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
});

console.log(`🚀 Server is running on http://localhost:${port}`); 