export class KalshiApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Kalshi demo API returned HTTP ${status}: ${responseBody}`);
    this.name = "KalshiApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class KalshiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiConfigError";
  }
}
