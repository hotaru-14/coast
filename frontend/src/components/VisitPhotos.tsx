import React, { useState, useEffect } from 'react';
import { coastApi } from '../services/coastApi';
import type { VisitPhoto } from '../services/coastApi';

interface VisitPhotosProps {
  visitId: string;
  className?: string;
  expanded?: boolean;
  onPhotosChange?: (photos: VisitPhoto[]) => void;
}

const VisitPhotosComponent: React.FC<VisitPhotosProps> = ({
  visitId,
  className = '',
  expanded = false,
  onPhotosChange
}) => {
  const [photos, setPhotos] = useState<VisitPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  // 写真一覧を読み込み
  useEffect(() => {
    loadPhotos();
  }, [visitId]);

  const loadPhotos = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await coastApi.getPhotos(visitId);
      setPhotos(data.photos);
      onPhotosChange?.(data.photos);
    } catch (err) {
      // 404エラーの場合は写真が存在しないとして扱う
      if (err instanceof Error && err.message.includes('訪問が見つからない')) {
        setPhotos([]);
        onPhotosChange?.([]);
      } else {
        setError(err instanceof Error ? err.message : '写真の読み込みに失敗しました');
        console.error('Photos load error:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      
      const newPhoto = await coastApi.uploadPhoto(visitId, {
        file,
        is_primary: photos.length === 0 // 最初の写真は自動的にメイン写真
      });
      
      // 写真一覧を再読み込み
      await loadPhotos();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '写真のアップロードに失敗しました');
      console.error('Photo upload error:', err);
    } finally {
      setUploading(false);
      // input をリセット
      event.target.value = '';
    }
  };

  const handleSetPrimary = async (photoId: string) => {
    try {
      setError(null);
      await coastApi.setPrimaryPhoto(visitId, photoId);
      await loadPhotos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'メイン写真の設定に失敗しました');
      console.error('Set primary photo error:', err);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm('この写真を削除しますか？')) return;

    try {
      setError(null);
      await coastApi.deletePhoto(visitId, photoId);
      await loadPhotos();
    } catch (err) {
      setError(err instanceof Error ? err.message : '写真の削除に失敗しました');
      console.error('Photo delete error:', err);
    }
  };

  const openModal = (index: number) => {
    setSelectedPhotoIndex(index);
  };

  const closeModal = () => {
    setSelectedPhotoIndex(null);
  };

  const navigateModal = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;
    
    if (direction === 'prev') {
      setSelectedPhotoIndex(selectedPhotoIndex > 0 ? selectedPhotoIndex - 1 : photos.length - 1);
    } else {
      setSelectedPhotoIndex(selectedPhotoIndex < photos.length - 1 ? selectedPhotoIndex + 1 : 0);
    }
  };

  if (loading) {
    return (
      <div className={`p-3 ${className}`}>
        <div className="text-gray-500 text-sm">写真を読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-3 bg-red-50 border border-red-200 rounded ${className}`}>
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={loadPhotos}
          className="mt-2 px-2 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
        >
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {/* 写真アップロード */}
      <div className="mb-3">
        <div className="flex items-center space-x-2">
          <label className="cursor-pointer inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
            {uploading ? '📤 アップロード中...' : '📷 写真を追加'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <span className="text-xs text-gray-500">
            JPEG, PNG, WebP (最大10MB)
          </span>
        </div>
      </div>

      {/* 写真一覧 */}
      {photos.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <div className="text-2xl mb-2">📸</div>
          <p className="text-sm">まだ写真がありません</p>
          <p className="text-xs mt-1">上のボタンから写真をアップロードしましょう</p>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.id} className="relative group">
                {/* 写真サムネイル */}
                <div 
                  className="aspect-square bg-gray-200 rounded cursor-pointer overflow-hidden"
                  onClick={() => openModal(index)}
                >
                  {photo.signed_url ? (
                    <img
                      src={photo.signed_url}
                      alt={photo.file_name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <span className="text-2xl">📸</span>
                    </div>
                  )}
                </div>

                {/* メイン写真バッジ */}
                {photo.is_primary && (
                  <div className="absolute top-1 left-1 px-1 py-0.5 bg-yellow-500 text-white text-xs rounded">
                    メイン
                  </div>
                )}

                {/* ホバー時のコントロール */}
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-1">
                  {!photo.is_primary && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetPrimary(photo.id);
                      }}
                      className="px-2 py-1 bg-yellow-500 text-white text-xs rounded hover:bg-yellow-600"
                      title="メイン写真に設定"
                    >
                      ⭐
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePhoto(photo.id);
                    }}
                    className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                    title="削除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 text-xs text-gray-500 text-center">
            {photos.length}枚の写真
          </div>
        </div>
      )}

      {/* 写真拡大モーダル */}
      {selectedPhotoIndex !== null && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center"
          onClick={closeModal}
        >
          <div className="relative max-w-4xl max-h-full p-4">
            {/* 閉じるボタン */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-white text-2xl z-10 hover:bg-black hover:bg-opacity-50 rounded-full w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>

            {/* 前の写真ボタン */}
            {photos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateModal('prev');
                }}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white text-2xl hover:bg-black hover:bg-opacity-50 rounded-full w-10 h-10 flex items-center justify-center"
              >
                ‹
              </button>
            )}

            {/* 次の写真ボタン */}
            {photos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateModal('next');
                }}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white text-2xl hover:bg-black hover:bg-opacity-50 rounded-full w-10 h-10 flex items-center justify-center"
              >
                ›
              </button>
            )}

            {/* 写真 */}
            {photos[selectedPhotoIndex]?.signed_url && (
              <img
                src={photos[selectedPhotoIndex].signed_url}
                alt={photos[selectedPhotoIndex].file_name}
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            )}

            {/* 写真情報 */}
            <div className="absolute bottom-4 left-4 right-4 text-white text-sm bg-black bg-opacity-50 rounded p-2">
              <div className="font-medium">{photos[selectedPhotoIndex]?.file_name}</div>
              <div className="text-xs opacity-75">
                {selectedPhotoIndex + 1} / {photos.length}
                {photos[selectedPhotoIndex]?.is_primary && ' • メイン写真'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisitPhotosComponent;