import React, { useState, useEffect } from 'react';
import { coastApi } from '../services/coastApi';
import type { VisitComment as VisitCommentType } from '../services/coastApi';

interface VisitCommentProps {
  visitId: string;
  className?: string;
  expanded?: boolean;
  onCommentChange?: (comment: VisitCommentType | null) => void;
}

const VisitCommentComponent: React.FC<VisitCommentProps> = ({
  visitId,
  className = '',
  expanded = false,
  onCommentChange
}) => {
  const [comment, setComment] = useState<VisitCommentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 編集用の状態
  const [editData, setEditData] = useState({
    title: '',
    content: ''
  });

  // コメント読み込み
  useEffect(() => {
    loadComment();
  }, [visitId]);

  // 編集モード切り替え時にデータを初期化
  useEffect(() => {
    if (isEditing) {
      setEditData({
        title: comment?.title || '',
        content: comment?.content || ''
      });
    }
  }, [isEditing, comment]);

  const loadComment = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await coastApi.getComment(visitId);
      setComment(data);
      onCommentChange?.(data);
    } catch (err) {
      // 404エラーの場合はコメントが存在しないとして扱う
      if (err instanceof Error && err.message.includes('訪問が見つからない')) {
        setComment(null);
        onCommentChange?.(null);
      } else {
        setError(err instanceof Error ? err.message : 'コメントの読み込みに失敗しました');
        console.error('Comment load error:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const updatedComment = await coastApi.upsertComment(visitId, editData);
      setComment(updatedComment);
      setIsEditing(false);
      onCommentChange?.(updatedComment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメントの保存に失敗しました');
      console.error('Comment save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!comment || !confirm('コメントを削除しますか？')) return;

    try {
      setSaving(true);
      await coastApi.deleteComment(visitId);
      setComment(null);
      setIsEditing(false);
      onCommentChange?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメントの削除に失敗しました');
      console.error('Comment delete error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditData({
      title: comment?.title || '',
      content: comment?.content || ''
    });
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  if (loading) {
    return (
      <div className={`p-3 ${className}`}>
        <div className="text-gray-500 text-sm">コメントを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-3 bg-red-50 border border-red-200 rounded ${className}`}>
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={loadComment}
          className="mt-2 px-2 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
        >
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {isEditing ? (
        // 編集モード
        <div className="space-y-3 p-3 bg-gray-50 rounded border">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              タイトル（任意）
            </label>
            <input
              type="text"
              value={editData.title}
              onChange={(e) => setEditData({ ...editData, title: e.target.value })}
              placeholder="タイトルを入力"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              コメント
            </label>
            <textarea
              value={editData.content}
              onChange={(e) => setEditData({ ...editData, content: e.target.value })}
              placeholder="訪問の思い出やメモを記録しましょう"
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 disabled:opacity-50"
            >
              キャンセル
            </button>
            {comment && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                削除
              </button>
            )}
          </div>
        </div>
      ) : (
        // 表示モード
        <div>
          {comment ? (
            <div className="space-y-2">
              {comment.title && (
                <h4 className="font-medium text-gray-900 text-sm">
                  {comment.title}
                </h4>
              )}
              
              {comment.content && (
                <div className={`text-gray-700 text-sm whitespace-pre-wrap ${!expanded && comment.content.length > 100 ? 'line-clamp-3' : ''}`}>
                  {expanded || comment.content.length <= 100 
                    ? comment.content 
                    : `${comment.content.substring(0, 100)}...`
                  }
                </div>
              )}
              
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {comment.updated_at !== comment.created_at 
                    ? `更新: ${new Date(comment.updated_at).toLocaleDateString('ja-JP')}`
                    : `作成: ${new Date(comment.created_at).toLocaleDateString('ja-JP')}`
                  }
                </span>
                
                <button
                  onClick={handleStartEdit}
                  className="text-blue-600 hover:text-blue-800"
                >
                  編集
                </button>
              </div>
            </div>
          ) : (
            // コメントがない場合
            <div className="text-center py-4">
              <p className="text-gray-500 text-sm mb-2">
                まだコメントがありません
              </p>
              <button
                onClick={handleStartEdit}
                className="px-3 py-1 text-sm text-blue-600 border border-blue-300 rounded hover:bg-blue-50"
              >
                コメントを追加
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisitCommentComponent;