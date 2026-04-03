"use client"

// @MX:ANCHOR: 약관 문서 소스 패널 컴포넌트
// @MX:REASON: JIT 문서 로딩의 유일한 UI 진입점. PDF 업로드 및 상품명 검색 두 경로를 통합 관리

import { useState, useRef, useCallback, useId } from "react"
import { FileText, Search, X, Upload, AlertCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { JITApiClient } from "@/lib/api/jit-client"
import type { DocumentMeta } from "@/lib/api/jit-client"

export type { DocumentMeta }

interface DocumentSourcePanelProps {
  sessionId: string
  onDocumentReady: (meta: DocumentMeta) => void
  onDocumentRemoved: () => void
  currentDocument: DocumentMeta | null
}

// 패널 UI 상태 (판별 유니온)
type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }

const ACCEPTED_FILE_TYPE = "application/pdf"
const MAX_FILE_SIZE_MB = 50
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// @MX:NOTE: PDF 파일 유효성 검사 (클라이언트 사이드)
function validatePDFFile(file: File): string | null {
  if (file.type !== ACCEPTED_FILE_TYPE) {
    return "PDF 파일만 업로드할 수 있습니다"
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `파일 크기는 ${MAX_FILE_SIZE_MB}MB 이하여야 합니다`
  }
  return null
}

/**
 * 약관 문서 소스 패널
 *
 * PDF 업로드 또는 보험 상품명 검색으로 약관을 채팅 세션에 연결합니다.
 * 문서가 연결된 상태(ready)에서는 문서 정보와 변경 버튼을 표시합니다.
 */
export default function DocumentSourcePanel({
  sessionId,
  onDocumentReady,
  onDocumentRemoved,
  currentDocument,
}: DocumentSourcePanelProps) {
  const [panelState, setPanelState] = useState<PanelState>({ kind: "idle" })
  const [productName, setProductName] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const jitClient = useRef(new JITApiClient())

  // 접근성을 위한 고유 ID
  const fileInputId = useId()
  const productInputId = useId()

  // PDF 업로드 처리
  const handleFileUpload = useCallback(
    async (file: File) => {
      const validationError = validatePDFFile(file)
      if (validationError) {
        setPanelState({ kind: "error", message: validationError })
        return
      }

      setPanelState({ kind: "loading", message: "약관을 분석하는 중입니다..." })

      try {
        const result = await jitClient.current.uploadPDF(file, sessionId)
        const meta: DocumentMeta = {
          productName: result.product_name,
          pageCount: result.page_count,
          sourceType: "pdf_upload",
          fetchedAt: new Date().toISOString(),
        }
        setPanelState({ kind: "idle" })
        onDocumentReady(meta)
      } catch (err) {
        const message = err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다"
        setPanelState({ kind: "error", message })
      }
    },
    [sessionId, onDocumentReady]
  )

  // 파일 input 변경 처리
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void handleFileUpload(file)
    }
    // 같은 파일 재선택 허용을 위해 value 초기화
    e.target.value = ""
  }

  // 드래그 앤 드롭 처리
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  // 상품명 검색 처리
  const handleProductSearch = useCallback(async () => {
    const trimmed = productName.trim()
    if (!trimmed) return

    setPanelState({ kind: "loading", message: "약관을 검색하는 중입니다..." })

    try {
      const result = await jitClient.current.findByProductName(trimmed, sessionId)
      const meta: DocumentMeta = {
        productName: trimmed,
        sourceUrl: result.source_url,
        pageCount: result.page_count,
        sourceType: "product_search",
        fetchedAt: new Date().toISOString(),
      }
      setPanelState({ kind: "idle" })
      setProductName("")
      onDocumentReady(meta)
    } catch (err) {
      const message = err instanceof Error ? err.message : "약관 검색 중 오류가 발생했습니다"
      setPanelState({ kind: "error", message })
    }
  }, [productName, sessionId, onDocumentReady])

  // 상품명 입력 Enter 키 처리
  const handleProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void handleProductSearch()
    }
  }

  // 문서 연결 해제 처리
  const handleRemoveDocument = useCallback(async () => {
    setPanelState({ kind: "loading", message: "문서 연결을 해제하는 중입니다..." })
    try {
      await jitClient.current.deleteDocument(sessionId)
      setPanelState({ kind: "idle" })
      onDocumentRemoved()
    } catch (err) {
      const message = err instanceof Error ? err.message : "문서 연결 해제 중 오류가 발생했습니다"
      setPanelState({ kind: "error", message })
    }
  }, [sessionId, onDocumentRemoved])

  const isLoading = panelState.kind === "loading"

  // ── ready 상태: 문서 정보 표시 ──
  if (currentDocument) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#1E40AF]">
              {currentDocument.productName ?? "업로드된 약관"}
            </p>
            <p className="text-xs text-[#3B82F6]">
              {currentDocument.pageCount}페이지
              {currentDocument.sourceType === "pdf_upload" ? " · PDF 업로드" : " · 약관 검색"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleRemoveDocument()}
          disabled={isLoading}
          className="ml-3 shrink-0 rounded px-2 py-1 text-xs text-[#3B82F6] transition-colors hover:bg-[#DBEAFE] hover:text-[#1D4ED8] disabled:opacity-50"
          aria-label="약관 문서 연결 해제"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            "변경하기"
          )}
        </button>
      </div>
    )
  }

  // ── loading 상태 ──
  if (panelState.kind === "loading") {
    return (
      <div className="flex items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2563EB]" aria-hidden="true" />
        <p className="text-sm text-[#475569]" role="status" aria-live="polite">
          {panelState.message}
        </p>
      </div>
    )
  }

  // ── error 상태 ──
  if (panelState.kind === "error") {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm text-[#B91C1C]" role="alert">
              {panelState.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPanelState({ kind: "idle" })}
            className="shrink-0 rounded p-0.5 text-[#EF4444] transition-colors hover:bg-[#FEE2E2]"
            aria-label="오류 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPanelState({ kind: "idle" })}
          className="mt-2 text-xs text-[#DC2626] underline underline-offset-2 hover:text-[#B91C1C]"
        >
          다시 시도하기
        </button>
      </div>
    )
  }

  // ── idle 상태: 두 가지 입력 옵션 ──
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <p className="mb-2.5 text-xs font-medium text-[#64748B]">
        약관을 연결하면 더 정확한 답변을 받을 수 있습니다
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* PDF 업로드 */}
        <div
          className={cn(
            "flex flex-1 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-3 transition-colors",
            isDragOver
              ? "border-[#2563EB] bg-[#EEF2FF]"
              : "border-[#CBD5E1] hover:border-[#2563EB] hover:bg-[#EEF2FF]"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="PDF 파일 업로드 영역. 클릭하거나 파일을 드래그하세요"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mb-1 h-4 w-4 text-[#94A3B8]" aria-hidden="true" />
          <label
            htmlFor={fileInputId}
            className="cursor-pointer text-xs text-[#475569]"
          >
            <span className="font-medium text-[#2563EB]">PDF 업로드</span>
            <span className="ml-1 hidden sm:inline">또는 드래그</span>
          </label>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileInputChange}
            className="sr-only"
            aria-label="PDF 파일 선택"
            tabIndex={-1}
          />
        </div>

        {/* 구분선 */}
        <div className="flex items-center justify-center">
          <span className="text-xs text-[#94A3B8]">또는</span>
        </div>

        {/* 상품명 검색 */}
        <div className="flex flex-1 items-center gap-1.5">
          <div className="flex flex-1 items-center rounded-md border border-[#E2E8F0] bg-white px-2.5">
            <label htmlFor={productInputId} className="sr-only">
              보험 상품명 입력
            </label>
            <input
              id={productInputId}
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              onKeyDown={handleProductKeyDown}
              placeholder="보험 상품명 검색"
              className="h-9 flex-1 bg-transparent text-xs text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
              aria-label="보험 상품명 입력 후 Enter 또는 검색 버튼 클릭"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleProductSearch()}
            disabled={!productName.trim()}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
              productName.trim()
                ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                : "cursor-not-allowed bg-[#E2E8F0] text-[#94A3B8]"
            )}
            aria-label="약관 검색"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
