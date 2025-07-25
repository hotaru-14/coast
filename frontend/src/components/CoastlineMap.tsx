import { useState, useEffect, useCallback } from 'react';
import { useGeolocation } from '../hooks/useGeolocation';
import { apiClient } from '../services/apiConfig';
import type { VisitResponse, RegisterVisitResponse } from '../services/coastApi';

interface CoastlineMapProps {
  className?: string;
}

export const CoastlineMap: React.FC<CoastlineMapProps> = ({ className = '' }) => {
  // 状態管理
  const [visits, setVisits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [nearestDistance, setNearestDistance] = useState<number | null>(null);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);
  const [registrationCooldown, setRegistrationCooldown] = useState(false);

  // 位置情報の取得（継続監視モード）
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
    maximumAge: 30000 // 30秒のキャッシュ
  });

  // 訪問履歴を取得
  const fetchVisits = useCallback(async () => {
    try {
      const response: VisitResponse = await apiClient.getVisits();
      setVisits(response.visitedIds);
      console.log('📍 Visited coastlines:', response.visitedIds);
    } catch (error) {
      console.error('Failed to fetch visits:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`訪問履歴の取得に失敗: ${errorMessage}`);
    }
  }, []);

  // 現在地での訪問チェック・登録
  const checkAndRegisterVisit = useCallback(async (lat: number, lng: number) => {
    if (registrationCooldown) {
      console.log('⏳ Registration cooldown active, skipping check');
      return;
    }

    try {
      setRegistrationCooldown(true);
      const response: RegisterVisitResponse = await apiClient.registerVisit({ lat, lng });
      
      setNearestDistance(response.distance || null);
      setLastCheckTime(new Date());
      
      if (response.success) {
        setMessage(`🎉 ${response.message}`);
        // 訪問履歴を再取得
        await fetchVisits();
      } else {
        setMessage(`📍 ${response.message}`);
        if (response.distance) {
          const distanceText = response.distance < 1000 
            ? `${Math.round(response.distance)}m`
            : `${(response.distance / 1000).toFixed(1)}km`;
          setMessage(prev => `${prev} (最寄りの海岸まで: ${distanceText})`);
        }
      }
    } catch (error) {
      console.error('Visit registration error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`訪問チェックエラー: ${errorMessage}`);
    } finally {
      // 30秒のクールダウン
      setTimeout(() => setRegistrationCooldown(false), 30000);
    }
  }, [registrationCooldown, fetchVisits]);

  // 位置情報が更新されたときの自動チェック
  useEffect(() => {
    if (coordinates && autoCheckEnabled && !geoLoading) {
      const { latitude, longitude } = coordinates;
      console.log(`🌍 Position updated: ${latitude}, ${longitude}`);
      checkAndRegisterVisit(latitude, longitude);
    }
  }, [coordinates, autoCheckEnabled, geoLoading, checkAndRegisterVisit]);

  // 初回読み込み
  useEffect(() => {
    const initializeComponent = async () => {
      setLoading(true);
      try {
        await fetchVisits();
      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeComponent();
  }, [fetchVisits]);

  // 手動チェックボタン
  const handleManualCheck = () => {
    if (coordinates) {
      checkAndRegisterVisit(coordinates.latitude, coordinates.longitude);
    } else {
      setMessage('位置情報が取得できません');
    }
  };

  // 位置情報の手動更新
  const handleRefreshLocation = () => {
    refetch();
    setMessage('位置情報を更新中...');
  };

  // ローディング中の表示
  if (loading) {
    return (
      <div className="coastline-map loading">
        <div className="loading-content">
          <div className="loading-spinner">🌊</div>
          <p>海岸線データを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`coastline-map ${className}`}>
      {/* ヘッダー */}
      <div className="map-header">
        <h2>🗾 海岸線マップ</h2>
        <div className="visit-counter">
          訪問済み: <strong>{visits.length}</strong> 箇所
        </div>
      </div>

      {/* 位置情報ステータス */}
      <div className="location-status">
        <div className="status-row">
          <span className="status-label">📍 位置情報:</span>
          {geoLoading ? (
            <span className="status-loading">取得中...</span>
          ) : geoError ? (
            <span className="status-error">
              エラー: {geoError.message}
              <button onClick={handleRefreshLocation} className="refresh-btn">
                再取得
              </button>
            </span>
          ) : coordinates ? (
            <span className="status-success">
              取得済み ({Math.round(accuracy || 0)}m精度)
              <button onClick={handleRefreshLocation} className="refresh-btn">
                更新
              </button>
            </span>
          ) : (
            <span className="status-waiting">位置情報を待機中...</span>
          )}
        </div>

        {coordinates && (
          <div className="coordinates">
            緯度: {coordinates.latitude.toFixed(6)}, 
            経度: {coordinates.longitude.toFixed(6)}
          </div>
        )}

        {nearestDistance !== null && (
          <div className="distance-info">
            最寄りの海岸まで: {
              nearestDistance < 1000 
                ? `${Math.round(nearestDistance)}m`
                : `${(nearestDistance / 1000).toFixed(1)}km`
            }
          </div>
        )}
      </div>

      {/* コントロールパネル */}
      <div className="control-panel">
        <div className="control-row">
          <label className="auto-check-toggle">
            <input
              type="checkbox"
              checked={autoCheckEnabled}
              onChange={(e) => setAutoCheckEnabled(e.target.checked)}
            />
            自動チェック
          </label>
          
          <button
            onClick={handleManualCheck}
            disabled={!coordinates || registrationCooldown}
            className="manual-check-btn"
          >
            {registrationCooldown ? '待機中...' : '手動チェック'}
          </button>
        </div>

        {lastCheckTime && (
          <div className="last-check">
            最終チェック: {lastCheckTime.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* メッセージ表示 */}
      {message && (
        <div className={`message ${message.includes('🎉') ? 'success' : 'info'}`}>
          {message}
        </div>
      )}

      {/* 訪問済み海岸線リスト */}
      <div className="visited-coastlines">
        <h3>🏖️ 訪問済み海岸線</h3>
        {visits.length === 0 ? (
          <p className="no-visits">まだ訪問した海岸線がありません。海岸に近づいてみましょう！</p>
        ) : (
          <div className="coastline-grid">
            {visits.map((coastlineId) => (
              <div key={coastlineId} className="coastline-item">
                <div className="coastline-id">{coastlineId}</div>
                <div className="visit-badge">✅</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 使い方説明 */}
      <div className="usage-info">
        <h3>📱 使い方</h3>
        <ul>
          <li>位置情報の許可をしてください</li>
          <li>海岸から500m以内に近づくと自動的に訪問が記録されます</li>
          <li>「手動チェック」ボタンでいつでもチェックできます</li>
          <li>同じ海岸線への重複登録は自動的に防がれます</li>
        </ul>
      </div>

      {/* デバッグ情報（開発時のみ） */}
      {import.meta.env.DEV && (
        <details className="debug-info">
          <summary>🔍 デバッグ情報</summary>
          <pre>
            {JSON.stringify({
              coordinates,
              accuracy,
              geoError: geoError?.message,
              visits,
              nearestDistance,
              autoCheckEnabled,
              registrationCooldown
            }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}; 