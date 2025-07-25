import React, { useState, useEffect } from 'react';
import { apiClient } from '../services/apiConfig';
import type { Visit } from '../services/coastApi';
import VisitCommentComponent from './VisitComment';

// 海岸線の座標を解析する関数
const parseLineString = (geometry: any): [number, number][] => {
  try {
    if (!geometry) return [];
    
    if (typeof geometry === 'object' && geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
    }
    
    return [];
  } catch (error) {
    console.error('Failed to parse geometry:', error);
    return [];
  }
};

interface VisitHistoryListProps {
  className?: string;
  onLocationFocus?: (location: [number, number]) => void;
  showComments?: boolean;
}

export const VisitHistoryList: React.FC<VisitHistoryListProps> = ({ 
  className = '',
  onLocationFocus,
  showComments = false
}) => {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());

  // 訪問履歴を取得
  const fetchVisits = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.getVisits();
      
      // visitsWithGeometryがある場合はそれを使用、なければ空配列
      setVisits(response.visitsWithGeometry || []);
    } catch (err) {
      console.error('Failed to fetch visits:', err);
      setError('訪問履歴の取得に失敗しました');
      setVisits([]);
    } finally {
      setLoading(false);
    }
  };

  // 初期化時に訪問履歴を取得
  useEffect(() => {
    fetchVisits();
  }, []);

  // リストアイテムをクリックした時の処理
  const handleItemClick = (visit: Visit) => {
    if (!onLocationFocus) return;

    const coords = parseLineString(visit.coastline.geometry);
    if (coords.length > 0) {
      // LineStringの中央付近の座標を取得
      const middleIndex = Math.floor(coords.length / 2);
      onLocationFocus(coords[middleIndex]);
    }
  };

  // 日付をフォーマット
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // 訪問の展開状態を切り替え
  const toggleExpanded = (visitId: string) => {
    const newExpanded = new Set(expandedVisits);
    if (newExpanded.has(visitId)) {
      newExpanded.delete(visitId);
    } else {
      newExpanded.add(visitId);
    }
    setExpandedVisits(newExpanded);
  };

  if (loading) {
    return (
      <div className={`visit-history-list ${className}`}>
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-bold mb-3">📝 訪問履歴</h3>
          <div className="text-center text-gray-500">
            <div className="text-2xl mb-2">🌊</div>
            <p>読み込み中...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`visit-history-list ${className}`}>
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-bold mb-3">📝 訪問履歴</h3>
          <div className="text-center text-red-500">
            <div className="text-2xl mb-2">❌</div>
            <p>{error}</p>
            <button 
              onClick={fetchVisits}
              className="mt-2 px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
            >
              再試行
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`visit-history-list ${className}`}>
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold">📝 訪問履歴</h3>
          <div className="text-sm text-gray-600">
            {visits.length}件
          </div>
        </div>

        {visits.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-3xl mb-2">🏖️</div>
            <p>まだ訪問した海岸線がありません</p>
            <p className="text-sm mt-1">地図で海岸線の近くに行って訪問登録をしてみましょう！</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {visits.map((visit) => {
              const isExpanded = expandedVisits.has(visit.id);
              
              return (
                <div
                  key={visit.id}
                  className="bg-white rounded border hover:border-blue-300 transition-colors"
                >
                  <div
                    onClick={() => handleItemClick(visit)}
                    className={`p-3 ${onLocationFocus ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">
                          {visit.coastline.name || visit.coastline.id}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {formatDate(visit.visitedAt)}
                        </p>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        {showComments && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(visit.id);
                            }}
                            className="text-sm text-gray-500 hover:text-gray-700"
                          >
                            {isExpanded ? '▼' : '▶'} コメント
                          </button>
                        )}
                        
                        {onLocationFocus && (
                          <div className="text-blue-500">
                            <span className="text-sm">📍</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {showComments && isExpanded && (
                    <div className="px-3 pb-3 border-t bg-gray-50">
                      <VisitCommentComponent
                        visitId={visit.id}
                        expanded={true}
                        className="mt-3"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 pt-3 border-t">
          <button
            onClick={fetchVisits}
            className="w-full px-3 py-2 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            更新
          </button>
        </div>
      </div>
    </div>
  );
};