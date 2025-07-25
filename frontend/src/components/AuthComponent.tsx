import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { User } from '@supabase/supabase-js';

interface AuthComponentProps {
  children: React.ReactNode;
}

export const AuthComponent: React.FC<AuthComponentProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // 初期認証状態を取得
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setLoading(false);
    };

    getInitialSession();

    // 認証状態の変更を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
        
        if (event === 'SIGNED_IN') {
          setMessage('ログインしました！');
        } else if (event === 'SIGNED_OUT') {
          setMessage('ログアウトしました');
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isSignUp) {
        // サインアップ
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;
        
        if (data.user && !data.session) {
          setMessage('確認メールを送信しました。メールをチェックしてください。');
        }
      } else {
        // サインイン
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessage(`エラー: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage(`サインアウトエラー: ${error.message}`);
    }
  };

  // ローディング中
  if (loading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner">🌊</div>
        <p>認証状態を確認中...</p>
      </div>
    );
  }

  // ユーザーがログインしている場合
  if (user) {
    return (
      <div>
        <div className="auth-header">
          <div className="user-info">
            <span>👋 こんにちは、{user.email}さん</span>
            <button onClick={handleSignOut} className="sign-out-btn">
              サインアウト
            </button>
          </div>
        </div>
        {children}
      </div>
    );
  }

  // ログインフォーム
  return (
    <div className="auth-container">
      <div className="auth-form">
        <h1>🌊 Coast Explorer</h1>
        <p>海岸線を巡って記録しよう！</p>
        
        <form onSubmit={handleAuth}>
          <div className="form-group">
            <label htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="password"
              minLength={6}
            />
          </div>
          
          <button type="submit" disabled={loading} className="auth-submit-btn">
            {loading ? '処理中...' : (isSignUp ? 'アカウント作成' : 'ログイン')}
          </button>
        </form>
        
        <div className="auth-switch">
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="switch-mode-btn"
          >
            {isSignUp 
              ? 'すでにアカウントをお持ちですか？ログイン' 
              : 'アカウントをお持ちでない方はこちら'}
          </button>
        </div>
        
        {message && (
          <div className={`auth-message ${message.includes('エラー') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
        
        {/* デモ用の説明 */}
        <div className="demo-info">
          <h3>🧪 デモ用情報</h3>
          <p>新しいアカウントを作成するか、テスト用のアカウントでログインしてください。</p>
          <small>
            位置情報の許可が必要です。海岸から500m以内にいると自動的に訪問が記録されます。
          </small>
        </div>
      </div>
    </div>
  );
}; 