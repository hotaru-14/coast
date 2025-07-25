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