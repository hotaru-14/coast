import { FeatureCollection, LineString } from 'geojson';

const OVERPASS_API_URL = 'https://lz4.overpass-api.de/api/interpreter';

export interface OSMCoastlineData {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: LineString;
    properties: {
      id: number;
      tags?: Record<string, string>;
    };
  }>;
}

export class OSMDataFetcher {
  private static readonly IWATE_OVERPASS_QUERY = `[out:json][timeout:120];
(
  way["natural"="coastline"](38.0,140.0,41.0,142.5);
);
out geom;`;

  static async fetchIwateCoastline(): Promise<OSMCoastlineData> {
    try {
      console.log('岩手県の海岸線データを取得中...');
      
      // curlを使ってデータ取得
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const fs = await import('fs/promises');

      // 一時ファイル作成
      const queryFile = '/tmp/iwate-query.txt';
      const outputFile = '/tmp/iwate-coastline.json';
      
      await fs.writeFile(queryFile, this.IWATE_OVERPASS_QUERY);

      console.log('curlでOverpass APIからデータを取得中...');
      
      const curlCommand = `curl -X POST -H "Content-Type: text/plain" -d @"${queryFile}" "${OVERPASS_API_URL}" -o "${outputFile}" --connect-timeout 60 --max-time 300`;
      
      await execAsync(curlCommand);

      // 結果を読み込み
      const rawData = await fs.readFile(outputFile, 'utf8');
      console.log('取得したデータサイズ:', rawData.length, 'バイト');
      
      const osmData = JSON.parse(rawData);
      console.log('パースしたデータ:', { 
        hasElements: !!osmData.elements, 
        elementCount: osmData.elements?.length || 0 
      });

      // 一時ファイル削除
      await fs.unlink(queryFile).catch(() => {});
      await fs.unlink(outputFile).catch(() => {});
      
      if (!osmData.elements || osmData.elements.length === 0) {
        console.log('デバッグ: osmData構造:', Object.keys(osmData));
        throw new Error('岩手県の海岸線データが見つかりませんでした');
      }

      console.log(`${osmData.elements.length} 個の海岸線要素を取得しました`);

      // OSMデータをGeoJSON形式に変換
      const geojson: OSMCoastlineData = {
        type: 'FeatureCollection',
        features: osmData.elements
          .filter((element: any) => element.type === 'way' && element.geometry)
          .map((way: any) => ({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: way.geometry.map((node: any) => [node.lon, node.lat])
            },
            properties: {
              id: way.id,
              tags: way.tags || {}
            }
          }))
      };

      console.log(`${geojson.features.length} 個の海岸線フィーチャーに変換しました`);
      
      return geojson;
    } catch (error) {
      console.error('詳細エラー:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`OSMデータ取得エラー: ${errorMessage}`);
    }
  }

  static async saveToFile(data: OSMCoastlineData, filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`データを ${filePath} に保存しました`);
  }
}