import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import multer from 'multer';
import sharp from 'sharp';
import { Readable } from 'stream';

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
  allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
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

// --- プロファイル管理エンドポイント ---

// GET /api/profile - ユーザープロファイル取得
app.get('/api/profile', async (c) => {
  const supabase = c.get('supabase');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // プロファイル情報を取得
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, display_name, avatar_url, created_at')
      .eq('id', userData.user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = No rows returned
      console.error('Error fetching profile:', error);
      return c.json({ error: error.message }, 500);
    }
    
    // プロファイルが存在しない場合はデフォルト値で作成
    if (!data) {
      const { data: newProfile, error: createError } = await supabase
        .from('user_profiles')
        .insert({ id: userData.user.id })
        .select('id, display_name, avatar_url, created_at')
        .single();
        
      if (createError) {
        console.error('Error creating profile:', createError);
        return c.json({ error: createError.message }, 500);
      }
      
      return c.json(newProfile);
    }
    
    return c.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /api/profile - ユーザープロファイル更新
app.put('/api/profile', async (c) => {
  const supabase = c.get('supabase');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // リクエストボディを取得
    const { display_name, avatar_url } = await c.req.json();
    
    // プロファイルを更新（upsert）
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        id: userData.user.id,
        display_name,
        avatar_url,
        updated_at: new Date().toISOString()
      })
      .select('id, display_name, avatar_url, created_at, updated_at')
      .single();
    
    if (error) {
      console.error('Error updating profile:', error);
      return c.json({ error: error.message }, 500);
    }
    
    return c.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// --- コメント管理エンドポイント ---

// GET /api/visits/:visitId/comment - 訪問のコメント取得
app.get('/api/visits/:visitId/comment', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // コメントを取得
    const { data, error } = await supabase
      .from('visit_comments')
      .select('id, visit_id, title, content, created_at, updated_at')
      .eq('visit_id', visitId)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = No rows returned
      console.error('Error fetching comment:', error);
      return c.json({ error: error.message }, 500);
    }
    
    // コメントが存在しない場合はnullを返す
    if (!data) {
      return c.json(null);
    }
    
    return c.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /api/visits/:visitId/comment - コメント作成・更新
app.put('/api/visits/:visitId/comment', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      console.error('Auth error:', userError);
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      console.error('Visit verification failed:', { visitId, userId: userData.user.id, visitError });
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // リクエストボディを取得
    const { title, content } = await c.req.json();
    
    // 既存のコメントを確認
    const { data: existingComment } = await supabase
      .from('visit_comments')
      .select('id')
      .eq('visit_id', visitId)
      .single();

    let data, error;
    
    if (existingComment) {
      // 更新
      ({ data, error } = await supabase
        .from('visit_comments')
        .update({ title, content })
        .eq('visit_id', visitId)
        .select('id, visit_id, title, content, created_at, updated_at')
        .single());
    } else {
      // 新規作成
      ({ data, error } = await supabase
        .from('visit_comments')
        .insert({ visit_id: visitId, title, content })
        .select('id, visit_id, title, content, created_at, updated_at')
        .single());
    }
    
    if (error) {
      console.error('Error upserting comment:', error);
      return c.json({ error: error.message }, 500);
    }
    
    return c.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /api/visits/:visitId/comment - コメント削除
app.delete('/api/visits/:visitId/comment', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // コメント削除
    const { error } = await supabase
      .from('visit_comments')
      .delete()
      .eq('visit_id', visitId);
    
    if (error) {
      console.error('Error deleting comment:', error);
      return c.json({ error: error.message }, 500);
    }
    
    return c.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// --- 写真管理エンドポイント ---

// POST /api/visits/:visitId/photos - 写真アップロード
app.post('/api/visits/:visitId/photos', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      console.error('Auth error:', userError);
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      console.error('Visit verification failed:', { visitId, userId: userData.user.id, visitError });
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // multipart/form-dataを解析
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const isPrimary = formData.get('is_primary') === 'true';
    
    if (!file) {
      return c.json({ error: 'No file uploaded' }, 400);
    }
    
    // ファイル検証
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' }, 400);
    }
    
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return c.json({ error: 'File too large. Maximum size is 10MB.' }, 400);
    }
    
    // ファイルを Buffer に変換
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Sharp で画像を処理（リサイズ・最適化）
    const processedImage = await sharp(buffer)
      .resize(1920, 1920, { 
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    // 画像メタデータを取得
    const metadata = await sharp(processedImage).metadata();
    
    // ファイル名を生成
    const fileExtension = 'jpg'; // 常にJPEGに変換
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;
    const storagePath = `${userData.user.id}/${visitId}/${fileName}`;
    
    // Supabase Storage にアップロード
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('visit-photos')
      .upload(storagePath, processedImage, {
        contentType: 'image/jpeg',
        upsert: false
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return c.json({ error: 'Failed to upload image' }, 500);
    }
    
    // メイン写真に設定する場合、他のメイン写真を解除
    if (isPrimary) {
      await supabase
        .from('visit_photos')
        .update({ is_primary: false })
        .eq('visit_id', visitId);
    }
    
    // データベースに写真情報を保存
    const { data: photoData, error: dbError } = await supabase
      .from('visit_photos')
      .insert({
        visit_id: visitId,
        storage_path: storagePath,
        file_name: file.name,
        file_size_bytes: processedImage.length,
        mime_type: 'image/jpeg',
        is_primary: isPrimary,
        width: metadata.width,
        height: metadata.height,
        sort_order: 0
      })
      .select('id, storage_path, file_name, file_size_bytes, mime_type, is_primary, width, height, sort_order, created_at')
      .single();
    
    if (dbError) {
      // アップロード済みファイルを削除
      await supabase.storage
        .from('visit-photos')
        .remove([storagePath]);
      
      console.error('Database error:', dbError);
      return c.json({ error: 'Failed to save photo metadata' }, 500);
    }
    
    // signed URLを生成
    const { data: signedUrlData } = await supabase.storage
      .from('visit-photos')
      .createSignedUrl(storagePath, 3600);
    
    return c.json({
      ...photoData,
      signed_url: signedUrlData?.signedUrl || null
    });
    
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/visits/:visitId/photos - 写真一覧取得
app.get('/api/visits/:visitId/photos', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      console.error('Auth error:', userError);
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      console.error('Visit verification failed:', { visitId, userId: userData.user.id, visitError });
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // 写真一覧を取得
    const { data: photos, error } = await supabase
      .from('visit_photos')
      .select('id, storage_path, file_name, file_size_bytes, mime_type, is_primary, width, height, sort_order, created_at')
      .eq('visit_id', visitId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching photos:', error);
      return c.json({ error: error.message }, 500);
    }
    
    // 各写真にsigned URLを生成
    const photosWithUrls = await Promise.all(
      (photos || []).map(async (photo) => {
        try {
          const { data: signedUrlData } = await supabase.storage
            .from('visit-photos')
            .createSignedUrl(photo.storage_path, 3600); // 1時間有効
          
          return {
            ...photo,
            signed_url: signedUrlData?.signedUrl || null
          };
        } catch (err) {
          console.error('Error creating signed URL for photo:', photo.id, err);
          return {
            ...photo,
            signed_url: null
          };
        }
      })
    );
    
    return c.json({ photos: photosWithUrls });
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /api/visits/:visitId/photos/:photoId/main - メイン写真設定
app.put('/api/visits/:visitId/photos/:photoId/main', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  const photoId = c.req.param('photoId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      console.error('Auth error:', userError);
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 写真が存在し、ユーザーのものか確認
    const { data: photoData, error: photoError } = await supabase
      .from('visit_photos')
      .select('id, visit_id')
      .eq('id', photoId)
      .eq('visit_id', visitId)
      .single();
    
    if (photoError || !photoData) {
      return c.json({ error: 'Photo not found or access denied' }, 404);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // 他のメイン写真を解除
    await supabase
      .from('visit_photos')
      .update({ is_primary: false })
      .eq('visit_id', visitId);
    
    // 指定された写真をメイン写真に設定
    const { data: updatedPhoto, error: updateError } = await supabase
      .from('visit_photos')
      .update({ is_primary: true })
      .eq('id', photoId)
      .select('id, storage_path, file_name, file_size_bytes, mime_type, is_primary, width, height, sort_order, created_at')
      .single();
    
    if (updateError) {
      console.error('Update error:', updateError);
      return c.json({ error: 'Failed to set primary photo' }, 500);
    }
    
    // signed URLを生成
    const { data: signedUrlData } = await supabase.storage
      .from('visit-photos')
      .createSignedUrl(updatedPhoto.storage_path, 3600);
    
    return c.json({
      ...updatedPhoto,
      signed_url: signedUrlData?.signedUrl || null
    });
    
  } catch (err) {
    console.error('Unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /api/visits/:visitId/photos/:photoId - 写真削除
app.delete('/api/visits/:visitId/photos/:photoId', async (c) => {
  const supabase = c.get('supabase');
  const visitId = c.req.param('visitId');
  const photoId = c.req.param('photoId');
  
  try {
    // 現在のユーザー情報を取得
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData.user) {
      console.error('Auth error:', userError);
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // 写真情報を取得（削除前にストレージパスが必要）
    const { data: photoData, error: photoError } = await supabase
      .from('visit_photos')
      .select('id, visit_id, storage_path')
      .eq('id', photoId)
      .eq('visit_id', visitId)
      .single();
    
    if (photoError || !photoData) {
      return c.json({ error: 'Photo not found or access denied' }, 404);
    }
    
    // 訪問が自分のものか確認
    const { data: visitData, error: visitError } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('user_id', userData.user.id)
      .single();
    
    if (visitError || !visitData) {
      return c.json({ error: 'Visit not found or access denied' }, 404);
    }
    
    // データベースから写真レコードを削除
    const { error: deleteError } = await supabase
      .from('visit_photos')
      .delete()
      .eq('id', photoId);
    
    if (deleteError) {
      console.error('Database delete error:', deleteError);
      return c.json({ error: 'Failed to delete photo record' }, 500);
    }
    
    // Storageから画像ファイルを削除
    const { error: storageError } = await supabase.storage
      .from('visit-photos')
      .remove([photoData.storage_path]);
    
    if (storageError) {
      console.error('Storage delete error:', storageError);
      // ストレージ削除エラーは警告として扱う（データベースは既に削除済み）
    }
    
    return c.json({ message: 'Photo deleted successfully' });
    
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