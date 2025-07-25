import { supabase } from '../supabaseClient';

// API基本設定
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// 型定義
export interface CoastlineSegment {
  id: string;
  svg_id: string;
  name: string;
  visited_at?: string;
}

export interface Visit {
  id: string;
  visitedAt: string;
  coastline: {
    id: string;
    name: string;
    geometry: string;
  };
}

export interface VisitResponse {
  visitedIds: string[];
  visitsWithGeometry?: Visit[];
}

export interface RegisterVisitRequest {
  lat: number;
  lng: number;
}

export interface RegisterVisitResponse {
  success: boolean;
  message: string;
  distance?: number;
  coastline?: {
    id: string;
    name: string;
    geometry: string;
  };
}

export interface CoastlineData {
  coastlines: Array<{
    id: string;
    name: string;
    geometry: string;
  }>;
}

export interface HealthCheckResponse {
  status: string;
  message: string;
  schema?: string;
  distance_limit?: string;
}

// 新機能の型定義
export interface UserProfile {
  id: string;
  display_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at?: string;
}

export interface VisitComment {
  id: string;
  visit_id: string;
  title?: string;
  content?: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileRequest {
  display_name?: string;
  avatar_url?: string;
}

export interface UpsertCommentRequest {
  title?: string;
  content?: string;
}

// APIクライアントクラス
class CoastApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  // 認証トークンを取得するヘルパー関数
  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    return headers;
  }

  // ヘルスチェック（認証不要）
  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      const response = await fetch(`${this.baseURL}/health`);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Health check error:', error);
      throw error;
    }
  }

  // 訪問履歴の取得（認証必要）
  async getVisits(): Promise<VisitResponse> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/visits`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        throw new Error(`Failed to fetch visits: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get visits error:', error);
      throw error;
    }
  }

  // 訪問登録（認証必要）
  async registerVisit(location: RegisterVisitRequest): Promise<RegisterVisitResponse> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/register-visit`, {
        method: 'POST',
        headers,
        body: JSON.stringify(location),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        throw new Error(`Failed to register visit: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Register visit error:', error);
      throw error;
    }
  }

  // 海岸線データの取得（認証不要）
  async getCoastlines(): Promise<CoastlineData> {
    try {
      const response = await fetch(`${this.baseURL}/api/coastlines`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch coastlines: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get coastlines error:', error);
      throw error;
    }
  }

  // 現在地から最も近い海岸線を検索（距離計算のみ、登録はしない）
  async findNearestCoastline(lat: number, lng: number): Promise<{
    distance: number;
    coastline?: CoastlineSegment;
  }> {
    try {
      // まず登録を試してみて、結果から距離情報を取得
      const result = await this.registerVisit({ lat, lng });
      
      return {
        distance: result.distance || Infinity,
        // 実際の登録は避けて、距離情報のみを使用
        // （本来はこの用途専用のエンドポイントが望ましい）
      };
    } catch (error) {
      console.error('Find nearest coastline error:', error);
      return { distance: Infinity };
    }
  }

  // --- プロファイル管理API ---

  // プロファイル取得
  async getProfile(): Promise<UserProfile> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/profile`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        throw new Error(`Failed to fetch profile: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get profile error:', error);
      throw error;
    }
  }

  // プロファイル更新
  async updateProfile(profile: UpdateProfileRequest): Promise<UserProfile> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        throw new Error(`Failed to update profile: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }

  // --- コメント管理API ---

  // コメント取得
  async getComment(visitId: string): Promise<VisitComment | null> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/visits/${visitId}/comment`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        if (response.status === 404) {
          throw new Error('訪問が見つからないか、アクセス権限がありません。');
        }
        throw new Error(`Failed to fetch comment: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get comment error:', error);
      throw error;
    }
  }

  // コメント作成・更新
  async upsertComment(visitId: string, comment: UpsertCommentRequest): Promise<VisitComment> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/visits/${visitId}/comment`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(comment),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        if (response.status === 404) {
          throw new Error('訪問が見つからないか、アクセス権限がありません。');
        }
        throw new Error(`Failed to upsert comment: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Upsert comment error:', error);
      throw error;
    }
  }

  // コメント削除
  async deleteComment(visitId: string): Promise<{ message: string }> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseURL}/api/visits/${visitId}/comment`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('認証が必要です。ログインしてください。');
        }
        if (response.status === 404) {
          throw new Error('訪問が見つからないか、アクセス権限がありません。');
        }
        throw new Error(`Failed to delete comment: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Delete comment error:', error);
      throw error;
    }
  }
}

// シングルトンインスタンスをエクスポート
export const coastApi = new CoastApiClient();

// 認証状態の監視とトークン更新
supabase.auth.onAuthStateChange((event, session) => {
  console.log('🔐 Auth state changed:', event);
  if (session?.access_token) {
    console.log('✅ User authenticated');
  } else {
    console.log('❌ User not authenticated');
  }
}); 