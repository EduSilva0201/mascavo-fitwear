export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_ORIGIN: string;
}
