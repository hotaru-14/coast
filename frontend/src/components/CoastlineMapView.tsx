import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { useGeolocation } from '../hooks/useGeolocation';
import { apiClient } from '../services/apiConfig';
import type { VisitResponse, RegisterVisitResponse } from '../services/coastApi';
import 'leaflet/dist/leaflet.css';

// Leafletのデフォルトアイコンの問題を修正
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// 海岸線の色設定
const COASTLINE_COLORS = {
  unvisited: '#6B7280', // 灰色
  visited: '#DC2626'     // 赤色
};

// 海岸線セグメントの型定義
interface CoastlineSegment {
  id: string;
  name: string;
  geometry: string; // PostGIS LineString format
  isVisited: boolean;
}

// CoastlineData型はapiClient.getCoastlines()から取得

// GeoJSON LineString形式をLeaflet用座標配列に変換
const parseLineString = (geometry: any): [number, number][] => {
  try {
    // null/undefinedチェック
    if (!geometry) {
      console.warn('Geometry is null or undefined');
      return [];
    }
    
    // GeoJSON形式として処理（PostGISから返される標準形式）
    if (typeof geometry === 'object' && geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
    }
    
    console.warn('Unknown geometry format:', typeof geometry, geometry);
    return [];
  } catch (error) {
    console.error('Failed to parse geometry:', error, 'Type:', typeof geometry);
    return [];
  }
};

// 地図の中心を現在位置に移動するコンポーネント
const MapController: React.FC<{ 
  center: [number, number] | null;
  focusLocation: [number, number] | null;
}> = ({ center, focusLocation }) => {
  const map = useMap();
  
  useEffect(() => {
    if (focusLocation) {
      map.setView(focusLocation, 15); // 詳細表示のため高いズームレベル
    } else if (center) {
      map.setView(center, 13);
    }
  }, [center, focusLocation, map]);
  
  return null;
};

interface CoastlineMapViewProps {
  className?: string;
  focusLocation?: [number, number] | null;
}

export const CoastlineMapView: React.FC<CoastlineMapViewProps> = ({ 
  className = '', 
  focusLocation 
}) => {
  // 状態管理
  const [coastlines, setCoastlines] = useState<CoastlineSegment[]>([]);
  const [visits, setVisits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [registrationCooldown, setRegistrationCooldown] = useState(false);

  // 位置情報の取得
  const { 
    coordinates, 
    loading: geoLoading, 
    error: geoError,
    accuracy,
    refetch 
  } = useGeolocation({ 
    watch: true, 
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 30000
  });

  // 海岸線データを取得
  const fetchCoastlines = useCallback(async () => {
    try {
      const data = await apiClient.getCoastlines();
      return data.coastlines;
    } catch (error) {
      console.error('Failed to fetch coastlines:', error);
      throw error;
    }
  }, []);

  // 訪問履歴を取得
  const fetchVisits = useCallback(async () => {
    try {
      const response: VisitResponse = await apiClient.getVisits();
      setVisits(response.visitedIds);
      return response.visitedIds;
    } catch (error) {
      console.error('Failed to fetch visits:', error);
      return [];
    }
  }, []);

  // 海岸線データと訪問履歴を組み合わせ
  const loadMapData = useCallback(async () => {
    try {
      setLoading(true);
      const [coastlineData, visitedIds] = await Promise.all([
        fetchCoastlines(),
        fetchVisits()
      ]);

      const coastlinesWithVisitStatus = coastlineData.map(coastline => ({
        ...coastline,
        isVisited: visitedIds.includes(coastline.id)
      }));

      console.log('🏖️ Coastline data loaded:', {
        total: coastlineData.length,
        visited: visitedIds.length,
        sampleGeometry: coastlineData[0]?.geometry
      });

      setCoastlines(coastlinesWithVisitStatus);
      setMessage(`海岸線 ${coastlineData.length} 件を読み込みました`);
    } catch (error) {
      console.error('Failed to load map data:', error);
      setMessage('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [fetchCoastlines, fetchVisits]);

  // 訪問登録
  const registerVisit = useCallback(async () => {
    if (!coordinates || registrationCooldown) return;

    try {
      setRegistrationCooldown(true);
      const response: RegisterVisitResponse = await apiClient.registerVisit({
        lat: coordinates.latitude,
        lng: coordinates.longitude
      });

      if (response.success) {
        setMessage(`🎉 ${response.message}`);
        // 訪問状態を更新
        if (response.coastline) {
          setCoastlines(prev => prev.map(c => 
            c.id === response.coastline?.id 
              ? { ...c, isVisited: true }
              : c
          ));
          setVisits(prev => [...prev, response.coastline!.id]);
        }
      } else {
        const distanceText = response.distance 
          ? response.distance < 1000 
            ? `${Math.round(response.distance)}m`
            : `${(response.distance / 1000).toFixed(1)}km`
          : '';
        setMessage(`📍 ${response.message}${distanceText ? ` (${distanceText})` : ''}`);
      }
    } catch (error) {
      console.error('Registration failed:', error);
      setMessage('訪問登録に失敗しました');
    } finally {
      setTimeout(() => setRegistrationCooldown(false), 30000);
    }
  }, [coordinates, registrationCooldown]);

  // 初期化
  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  // デフォルト中心点（岩手県）
  const defaultCenter: [number, number] = [39.6403, 141.9569];
  const mapCenter = coordinates 
    ? [coordinates.latitude, coordinates.longitude] as [number, number]
    : defaultCenter;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-4xl mb-4">🌊</div>
          <p>海岸線データを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`coastline-map-view ${className}`}>
      {/* コントロールパネル */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold">🗾 海岸線マップ</h2>
          <div className="text-sm text-gray-600">
            訪問済み: <strong className="text-red-600">{visits.length}</strong> / {coastlines.length}
          </div>
        </div>
        
        {/* 位置情報ステータス */}
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm">
            <span>📍</span>
            {geoLoading ? (
              <span className="text-yellow-600">位置情報取得中...</span>
            ) : geoError ? (
              <span className="text-red-600">位置情報エラー</span>
            ) : coordinates ? (
              <span className="text-green-600">
                位置情報取得済み (精度: {Math.round(accuracy || 0)}m)
              </span>
            ) : (
              <span className="text-gray-600">位置情報待機中...</span>
            )}
            <button 
              onClick={refetch}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              更新
            </button>
          </div>
        </div>

        {/* 操作ボタン */}
        <div className="flex gap-2">
          <button
            onClick={registerVisit}
            disabled={!coordinates || registrationCooldown}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {registrationCooldown ? '待機中...' : '現在地で訪問登録'}
          </button>
          <button
            onClick={loadMapData}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            データ更新
          </button>
        </div>

        {/* メッセージ表示 */}
        {message && (
          <div className={`mt-2 p-2 rounded text-sm ${
            message.includes('🎉') 
              ? 'bg-green-100 text-green-800' 
              : 'bg-blue-100 text-blue-800'
          }`}>
            {message}
          </div>
        )}
      </div>

      {/* 地図表示 */}
      <div className="h-96 border rounded-lg overflow-hidden">
        <MapContainer
          center={mapCenter}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          className="leaflet-container"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MapController 
            center={coordinates ? mapCenter : null} 
            focusLocation={focusLocation || null}
          />
          
          {/* 現在位置マーカー */}
          {coordinates && (
            <Marker position={mapCenter}>
              <Popup>
                <div>
                  <strong>現在位置</strong><br />
                  緯度: {coordinates.latitude.toFixed(6)}<br />
                  経度: {coordinates.longitude.toFixed(6)}<br />
                  精度: {Math.round(accuracy || 0)}m
                </div>
              </Popup>
            </Marker>
          )}
          
          {/* 海岸線の描画 */}
          {coastlines.map((coastline, index) => {
            const coordinates = parseLineString(coastline.geometry);
            
            // デバッグ: 最初の数個の海岸線のみログ出力
            if (index < 3) {
              console.log(`🗺️ Coastline ${coastline.id}:`, {
                coordinates: coordinates.slice(0, 3), // 最初の3座標のみ
                totalPoints: coordinates.length,
                color: coastline.isVisited ? COASTLINE_COLORS.visited : COASTLINE_COLORS.unvisited
              });
            }
            
            if (coordinates.length === 0) {
              console.warn(`❌ Empty coordinates for coastline ${coastline.id}`);
              return null;
            }
            
            return (
              <Polyline
                key={coastline.id}
                positions={coordinates}
                color={coastline.isVisited ? COASTLINE_COLORS.visited : COASTLINE_COLORS.unvisited}
                weight={3}
                opacity={0.8}
              >
                <Popup>
                  <div>
                    <strong>{coastline.name || coastline.id}</strong><br />
                    状態: {coastline.isVisited ? '✅ 訪問済み' : '⭕ 未訪問'}<br />
                    ID: {coastline.id}<br />
                    座標数: {coordinates.length}
                  </div>
                </Popup>
              </Polyline>
            );
          })}
        </MapContainer>
      </div>

      {/* 凡例 */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-semibold mb-2">凡例</h3>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-gray-500"></div>
            <span>未訪問の海岸線</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-red-600"></div>
            <span>訪問済みの海岸線</span>
          </div>
        </div>
      </div>
    </div>
  );
};