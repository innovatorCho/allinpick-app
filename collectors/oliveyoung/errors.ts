/** Collector-specific errors. productCollector.ts maps each to a CollectStatus. */

export class ProductNotFoundError extends Error {
  constructor(message = "상품이 존재하지 않거나 판매가 종료되었습니다.") {
    super(message);
    this.name = "ProductNotFoundError";
  }
}

export class PriceNotFoundError extends Error {
  constructor(message = "페이지에서 가격 정보를 찾을 수 없습니다.") {
    super(message);
    this.name = "PriceNotFoundError";
  }
}

export class ParserError extends Error {
  constructor(message = "페이지 구조를 해석할 수 없습니다.") {
    super(message);
    this.name = "ParserError";
  }
}
