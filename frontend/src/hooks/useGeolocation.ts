import { useState, useEffect } from 'react';

interface GeolocationState {
  position: GeolocationPosition | null;
  error: GeolocationPositionError | null;
  loading: boolean;
}

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  watch?: boolean; // 位置の監視を継続するかどうか
}

export const useGeolocation = (options: UseGeolocationOptions = {}) => {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    loading: true,
  });

  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 60000,
    watch = false,
  } = options;

  useEffect(() => {
    // Geolocation APIが利用可能かチェック
    if (!navigator.geolocation) {
      setState({
        position: null,
        error: {
          code: 2,
          message: 'Geolocation is not supported by this browser',
        } as GeolocationPositionError,
        loading: false,
      });
      return;
    }

    let watchId: number | null = null;

    const onSuccess = (position: GeolocationPosition) => {
      setState({
        position,
        error: null,
        loading: false,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      console.error('Geolocation error:', error);
      setState({
        position: null,
        error,
        loading: false,
      });
    };

    const positionOptions: PositionOptions = {
      enableHighAccuracy,
      timeout,
      maximumAge,
    };

    // 位置情報を取得
    if (watch) {
      // 継続的な位置監視
      watchId = navigator.geolocation.watchPosition(
        onSuccess,
        onError,
        positionOptions
      );
    } else {
      // 一回限りの位置取得
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        onError,
        positionOptions
      );
    }

    // クリーンアップ関数
    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [enableHighAccuracy, timeout, maximumAge, watch]);

  // 手動で位置情報を再取得する関数
  const refetch = () => {
    setState(prev => ({ ...prev, loading: true }));
    
    const onSuccess = (position: GeolocationPosition) => {
      setState({
        position,
        error: null,
        loading: false,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      setState({
        position: null,
        error,
        loading: false,
      });
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      onError,
      { enableHighAccuracy, timeout, maximumAge }
    );
  };

  return {
    ...state,
    refetch,
    // 便利なヘルパー関数
    coordinates: state.position
      ? {
          latitude: state.position.coords.latitude,
          longitude: state.position.coords.longitude,
        }
      : null,
    accuracy: state.position?.coords.accuracy || null,
  };
}; 