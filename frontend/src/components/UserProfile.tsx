import React, { useState, useEffect } from 'react';
import { coastApi } from '../services/coastApi';
import type { UserProfile } from '../services/coastApi';

interface UserProfileProps {
  isEditing?: boolean;
  onEditToggle?: () => void;
  className?: string;
}

const UserProfileComponent: React.FC<UserProfileProps> = ({
  isEditing = false,
  onEditToggle,
  className = ''
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 編集用の状態
  const [editData, setEditData] = useState({
    display_name: '',
    avatar_url: ''
  });

  // プロファイル読み込み
  useEffect(() => {
    loadProfile();
  }, []);

  // 編集モード切り替え時にデータを初期化
  useEffect(() => {
    if (isEditing && profile) {
      setEditData({
        display_name: profile.display_name || '',
        avatar_url: profile.avatar_url || ''
      });
    }
  }, [isEditing, profile]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await coastApi.getProfile();
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロファイルの読み込みに失敗しました');
      console.error('Profile load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const updatedProfile = await coastApi.updateProfile(editData);
      setProfile(updatedProfile);
      onEditToggle?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロファイルの更新に失敗しました');
      console.error('Profile save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setEditData({
        display_name: profile.display_name || '',
        avatar_url: profile.avatar_url || ''
      });
    }
    onEditToggle?.();
  };

  if (loading) {
    return (
      <div className={`flex justify-center items-center p-4 ${className}`}>
        <div className="text-gray-500">プロファイルを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 bg-red-50 rounded-lg border border-red-200 ${className}`}>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={loadProfile}
          className="px-3 py-1 mt-2 text-sm text-red-600 rounded border border-red-300 hover:bg-red-50"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={`p-4 text-gray-500 ${className}`}>
        プロファイルが見つかりません
      </div>
    );
  }

  return (
    <div className={`p-4 bg-white rounded-lg border shadow-sm ${className}`}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          {isEditing ? (
            // 編集モード
            <div className="space-y-4">
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">
                  表示名
                </label>
                <input
                  type="text"
                  value={editData.display_name}
                  onChange={(e) => setEditData({ ...editData, display_name: e.target.value })}
                  placeholder="表示名を入力"
                  className="px-3 py-2 w-full rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">
                  アバターURL
                </label>
                <input
                  type="url"
                  value={editData.avatar_url}
                  onChange={(e) => setEditData({ ...editData, avatar_url: e.target.value })}
                  placeholder="https://example.com/avatar.jpg"
                  className="px-3 py-2 w-full rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            // 表示モード
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="アバター"
                    className="object-cover w-12 h-12 rounded-full border-2 border-gray-200"
                    onError={(e) => {
                      e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.display_name || 'User')}&background=0ea5e9&color=fff`;
                    }}
                  />
                ) : (
                  <div className="flex justify-center items-center w-12 h-12 font-medium text-white bg-blue-500 rounded-full">
                    {profile.display_name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    {profile.display_name || '名前未設定'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    登録日: {new Date(profile.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </div>
              </div>

              {onEditToggle && (
                <button
                  onClick={onEditToggle}
                  className="px-3 py-1 mt-3 text-sm text-blue-600 rounded border border-blue-300 hover:bg-blue-50"
                >
                  編集
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserProfileComponent;