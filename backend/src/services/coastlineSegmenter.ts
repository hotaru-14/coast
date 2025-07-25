import * as turf from '@turf/turf';
import { FeatureCollection, LineString, Feature } from 'geojson';
import { OSMCoastlineData } from './osmDataFetcher';

export interface CoastlineSegment {
  id: string;
  geometry: LineString;
  lengthMeters: number;
  originalWayId: number;
}

export interface SegmentationConfig {
  maxSegmentLength: number;  // メートル
  minSegmentLength: number;  // メートル
  simplificationTolerance: number; // 度単位
}

export class CoastlineSegmenter {
  private static readonly DEFAULT_CONFIG: SegmentationConfig = {
    maxSegmentLength: 1500,
    minSegmentLength: 300,
    simplificationTolerance: 0.0001
  };

  static segmentCoastlines(
    coastlineData: OSMCoastlineData, 
    config: SegmentationConfig = this.DEFAULT_CONFIG
  ): CoastlineSegment[] {
    const segments: CoastlineSegment[] = [];
    let segmentCounter = 0;

    console.log(`${coastlineData.features.length} 個の海岸線をセグメント分割中...`);

    for (const feature of coastlineData.features) {
      if (!feature.geometry || feature.geometry.type !== 'LineString') {
        continue;
      }

      const line = turf.lineString(feature.geometry.coordinates);
      const originalWayId = feature.properties.id;

      // 線の簡略化（ノイズ除去）
      const simplified = turf.simplify(line, {
        tolerance: config.simplificationTolerance,
        highQuality: true
      });

      // 線の長さを計算
      const totalLength = turf.length(simplified, { units: 'meters' });

      if (totalLength < config.minSegmentLength) {
        // 短すぎる線はそのまま1つのセグメントとして扱う
        segments.push({
          id: `segment_${segmentCounter++}`,
          geometry: simplified.geometry,
          lengthMeters: totalLength,
          originalWayId
        });
        continue;
      }

      // 最大長を超える場合は分割
      if (totalLength > config.maxSegmentLength) {
        const numSegments = Math.ceil(totalLength / config.maxSegmentLength);
        const segmentLength = totalLength / numSegments;

        for (let i = 0; i < numSegments; i++) {
          const startDistance = i * segmentLength;
          const endDistance = Math.min((i + 1) * segmentLength, totalLength);

          try {
            const startPoint = turf.along(simplified, startDistance / 1000, { units: 'kilometers' });
            const endPoint = turf.along(simplified, endDistance / 1000, { units: 'kilometers' });

            // セグメントの座標を抽出
            const segmentCoords = this.extractSegmentCoordinates(
              simplified,
              startPoint.geometry.coordinates,
              endPoint.geometry.coordinates
            );

            if (segmentCoords.length >= 2) {
              const segmentLine = turf.lineString(segmentCoords);
              const actualLength = turf.length(segmentLine, { units: 'meters' });

              segments.push({
                id: `segment_${segmentCounter++}`,
                geometry: segmentLine.geometry,
                lengthMeters: actualLength,
                originalWayId
              });
            }
          } catch (error) {
            console.warn(`セグメント分割エラー (way ${originalWayId}): ${error}`);
            // エラーの場合は元の線をそのまま使用
            segments.push({
              id: `segment_${segmentCounter++}`,
              geometry: simplified.geometry,
              lengthMeters: totalLength,
              originalWayId
            });
            break;
          }
        }
      } else {
        // 適切な長さの場合はそのまま使用
        segments.push({
          id: `segment_${segmentCounter++}`,
          geometry: simplified.geometry,
          lengthMeters: totalLength,
          originalWayId
        });
      }
    }

    console.log(`${segments.length} 個のセグメントに分割しました`);
    
    // 長さでフィルタリング
    const validSegments = segments.filter(s => s.lengthMeters >= config.minSegmentLength);
    console.log(`有効なセグメント: ${validSegments.length} 個`);

    return validSegments;
  }

  private static extractSegmentCoordinates(
    line: Feature<LineString>,
    startCoord: number[],
    endCoord: number[]
  ): number[][] {
    const coords = line.geometry.coordinates;
    const result: number[][] = [];

    // 開始点に最も近い座標のインデックスを見つける
    let startIndex = 0;
    let minStartDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const dist = turf.distance(startCoord, coords[i]);
      if (dist < minStartDist) {
        minStartDist = dist;
        startIndex = i;
      }
    }

    // 終了点に最も近い座標のインデックスを見つける
    let endIndex = coords.length - 1;
    let minEndDist = Infinity;
    for (let i = startIndex; i < coords.length; i++) {
      const dist = turf.distance(endCoord, coords[i]);
      if (dist < minEndDist) {
        minEndDist = dist;
        endIndex = i;
      }
    }

    // セグメントの座標を抽出
    if (startIndex <= endIndex) {
      for (let i = startIndex; i <= endIndex; i++) {
        result.push(coords[i]);
      }
    }

    return result.length >= 2 ? result : coords;
  }

  static async saveSegmentsToFile(segments: CoastlineSegment[], filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, JSON.stringify(segments, null, 2));
    console.log(`セグメントデータを ${filePath} に保存しました`);
  }
}