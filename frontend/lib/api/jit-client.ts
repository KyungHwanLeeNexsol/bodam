// @MX:ANCHOR: JIT(Just-In-Time) 문서 API 클라이언트
// @MX:REASON: DocumentSourcePanel에서 사용하는 공개 API 경계. PDF 업로드/상품 검색/문서 관리 담당

// HTTP 상태 코드별 한국어 오류 메시지 매핑
const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: "요청이 올바르지 않습니다",
  404: "문서를 찾을 수 없습니다",
  413: "파일 크기가 너무 큽니다",
  422: "입력값이 올바르지 않습니다",
  500: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요",
}

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요"

// JIT 업로드 API 응답
export interface JITUploadResponse {
  status: string
  product_name: string
  page_count: number
  session_id: string
}

// JIT 상품 검색 API 응답
export interface JITFindResponse {
  status: string
  source_url: string
  page_count: number
}

// 문서 메타데이터 (DocumentSourcePanel에서 사용)
export interface DocumentMeta {
  productName?: string
  sourceUrl?: string
  pageCount: number
  sourceType: "pdf_upload" | "product_search"
  fetchedAt: string
}

/**
 * JIT(Just-In-Time) 문서 로딩 API 클라이언트
 * PDF 업로드 및 보험 상품명 검색을 통해 약관 문서를 세션에 연결합니다.
 */
export class JITApiClient {
  readonly baseUrl: string

  constructor() {
    this.baseUrl =
      process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:8000"
  }

  /**
   * HTTP 오류 응답을 한국어 메시지로 변환합니다.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    const errorMessage = HTTP_ERROR_MESSAGES[response.status]
    if (errorMessage) {
      throw new Error(errorMessage)
    }

    try {
      const data: unknown = await response.json()
      if (
        data &&
        typeof data === "object" &&
        "detail" in data &&
        typeof (data as Record<string, unknown>)["detail"] === "string"
      ) {
        throw new Error((data as Record<string, string>)["detail"])
      }
    } catch (e) {
      if (e instanceof Error && e.message !== "Failed to parse JSON") {
        throw e
      }
    }

    throw new Error(`HTTP ${response.status} 오류가 발생했습니다`)
  }

  /**
   * 공통 fetch 요청 처리 (네트워크 오류 포함)
   */
  private async request(url: string, options: RequestInit): Promise<Response> {
    try {
      const response = await fetch(url, options)

      // 401 인증 실패 시 토큰 정리 후 로그인 페이지로 리다이렉트
      if (response.status === 401) {
        localStorage.removeItem("auth_token")
        document.cookie = "auth_token=; path=/; max-age=0"
        window.location.href = "/login"
        throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.")
      }

      return response
    } catch (e) {
      if (e instanceof Error && e.message.includes("인증이 만료")) {
        throw e
      }
      throw new Error(NETWORK_ERROR_MESSAGE)
    }
  }

  /**
   * PDF 파일을 업로드하여 약관 문서를 세션에 연결합니다.
   * @param file - 업로드할 PDF 파일
   * @param sessionId - 연결할 채팅 세션 ID
   * @returns JITUploadResponse
   */
  async uploadPDF(file: File, sessionId: string): Promise<JITUploadResponse> {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("session_id", sessionId)

    const response = await this.request(
      `${this.baseUrl}/api/v1/jit/upload`,
      {
        method: "POST",
        body: formData,
        // Content-Type은 FormData가 자동으로 multipart/form-data로 설정
      }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<JITUploadResponse>
  }

  /**
   * 보험 상품명으로 약관 문서를 검색하여 세션에 연결합니다.
   * @param productName - 보험 상품명
   * @param sessionId - 연결할 채팅 세션 ID
   * @returns JITFindResponse
   */
  async findByProductName(
    productName: string,
    sessionId: string
  ): Promise<JITFindResponse> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/jit/find`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: productName, session_id: sessionId }),
      }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<JITFindResponse>
  }

  /**
   * 세션에 연결된 문서 메타데이터를 조회합니다.
   * @param sessionId - 채팅 세션 ID
   * @returns DocumentMeta | null (문서가 없으면 null)
   */
  async getDocumentMeta(sessionId: string): Promise<DocumentMeta | null> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/jit/session/${sessionId}/document`,
      { method: "GET" }
    )

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<DocumentMeta>
  }

  /**
   * 세션에 연결된 문서를 삭제합니다.
   * @param sessionId - 채팅 세션 ID
   */
  async deleteDocument(sessionId: string): Promise<void> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/jit/session/${sessionId}/document`,
      { method: "DELETE" }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }
  }
}
