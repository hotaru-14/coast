import { useEffect, useState } from 'react'
import { AuthComponent } from './components/AuthComponent'
import { CoastlineMapView } from './components/CoastlineMapView'
import { VisitHistoryList } from './components/VisitHistoryList'
import UserProfileComponent from './components/UserProfile'
import { apiClient } from './services/apiConfig'
import './App.css'

function App() {
  const [apiStatus, setApiStatus] = useState<string>('checking...')
  const [focusLocation, setFocusLocation] = useState<[number, number] | null>(null)
  const [isProfileEditing, setIsProfileEditing] = useState(false)

  // APIヘルスチェック
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const health = await apiClient.healthCheck()
        setApiStatus(`✅ ${health.message} (${health.schema}, ${health.distance_limit})`)
      } catch (error) {
        console.error('API health check failed:', error)
        setApiStatus('❌ API接続エラー - バックエンドサーバーが起動していることを確認してください')
      }
    }

    checkApiHealth()
  }, [])

  return (
    <div className="app">
      <AuthComponent>
        <main className="main-content">
          <div className="api-status">
            <small>{apiStatus}</small>
          </div>
          
          {/* プロファイル表示エリア */}
          <div className="mb-4">
            <UserProfileComponent 
              isEditing={isProfileEditing}
              onEditToggle={() => setIsProfileEditing(!isProfileEditing)}
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <CoastlineMapView focusLocation={focusLocation} />
            </div>
            <div>
              <VisitHistoryList 
                onLocationFocus={setFocusLocation}
                showComments={true}
              />
            </div>
          </div>
        </main>
      </AuthComponent>
    </div>
  )
}

export default App
