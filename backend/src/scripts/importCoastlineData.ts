import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { OSMDataFetcher } from '../services/osmDataFetcher';
import { CoastlineSegmenter, CoastlineSegment } from '../services/coastlineSegmenter';

// 環境変数を読み込み
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が設定されていません');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface DatabaseSegment {
  svg_id: string;
  geom: string; // PostGIS LineString format
  name?: string;
}

class CoastlineImporter {
  static async importIwateCoastline(): Promise<void> {
    try {
      console.log('=== 岩手県海岸線データインポート開始 ===');

      // 1. OSMから岩手県の海岸線データを取得
      console.log('\n1. OSMデータ取得中...');
      const coastlineData = await OSMDataFetcher.fetchIwateCoastline();
      
      // データをファイルに保存（デバッグ用）
      const dataDir = path.join(__dirname, '../../data');
      await this.ensureDirectoryExists(dataDir);
      await OSMDataFetcher.saveToFile(coastlineData, path.join(dataDir, 'iwate_coastline_raw.geojson'));

      // 2. セグメント分割
      console.log('\n2. セグメント分割中...');
      const segments = CoastlineSegmenter.segmentCoastlines(coastlineData);
      
      // セグメントデータをファイルに保存（デバッグ用）
      await CoastlineSegmenter.saveSegmentsToFile(segments, path.join(dataDir, 'iwate_coastline_segments.json'));

      // 3. Supabaseにインポート
      console.log('\n3. Supabaseにインポート中...');
      await this.importToSupabase(segments);

      console.log('\n=== インポート完了 ===');
      console.log(`総セグメント数: ${segments.length}`);
      
    } catch (error) {
      console.error('インポートエラー:', error);
      throw error;
    }
  }

  private static async importToSupabase(segments: CoastlineSegment[]): Promise<void> {
    console.log(`${segments.length} 個のセグメントをインポート中...`);

    // 既存の岩手県データをクリア（開発時のみ）
    console.log('既存データをクリア中...');
    const { error: deleteError } = await supabase
      .from('coastline_segments')
      .delete()
      .like('svg_id', 'segment_%');
    
    if (deleteError) {
      console.warn('既存データクリアエラー:', deleteError);
    }

    // バッチサイズ（Supabaseの制限を考慮）
    const BATCH_SIZE = 100;
    let importedCount = 0;

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      const dbSegments: DatabaseSegment[] = batch.map(segment => ({
        svg_id: segment.id,
        geom: this.lineStringToPostGIS(segment.geometry),
        name: `岩手県海岸線セグメント ${segment.id}`
      }));

      const { error } = await supabase
        .from('coastline_segments')
        .insert(dbSegments);

      if (error) {
        console.error(`バッチ ${Math.floor(i / BATCH_SIZE) + 1} インポートエラー:`, error);
        throw error;
      }

      importedCount += batch.length;
      console.log(`進捗: ${importedCount}/${segments.length} (${Math.round(importedCount / segments.length * 100)}%)`);
    }

    console.log(`✅ ${importedCount} 個のセグメントをインポートしました`);
  }

  private static lineStringToPostGIS(geometry: any): string {
    const coords = geometry.coordinates;
    const coordStrings = coords.map((coord: number[]) => `${coord[0]} ${coord[1]}`).join(',');
    return `LINESTRING(${coordStrings})`;
  }

  private static async ensureDirectoryExists(dirPath: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}

// スクリプト実行
async function main() {
  if (process.argv[2] === '--import') {
    try {
      await CoastlineImporter.importIwateCoastline();
      process.exit(0);
    } catch (error) {
      console.error('実行エラー:', error);
      process.exit(1);
    }
  } else {
    console.log('使用方法: ts-node src/scripts/importCoastlineData.ts --import');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}