'use client'

/**
 * PDF 업로더 컴포넌트 (SPEC-PDF-001)
 *
 * 드래그 앤 드롭 및 클릭으로 PDF 파일을 업로드하는 컴포넌트.
 * XMLHttpRequest 기반 업로드 진행률 표시 지원.
 */

import { useCallback, useRef, useState } from 'react'
import { uploadPdfApi } from '@/lib/pdf'

interface PDFUploaderProps {
  token: string
  onUploadComplete: (uploadId: string, filename: string) => void
}

const MAX_FILE_SIZE_MB = 50
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/**
 * PDFUploader 컴포넌트
 *
 * 드래그 앤 드롭 또는 클릭으로 PDF 파일 선택 후 업로드.
 * 50MB 초과 시 클라이언트 사이드 검증 오류 표시.
 */
export default function PDFUploader({ token, onUploadComplete }: PDFUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = (file: File): string | null => {
    if (file.type !== 'application/pdf') {
      return 'PDF 파일만 업로드 가능합니다.'
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `파일 크기는 ${MAX_FILE_SIZE_MB}MB를 초과할 수 없습니다.`
    }
    return null
  }

  const handleFileSelect = useCallback(
    async (file: File) => {
      setError(null)
      const validationError = validateFile(file)
      if (validationError) {
        setError(validationError)
        return
      }

      setSelectedFile(file)
      setIsUploading(true)
      setUploadProgress(0)

      try {
        const result = await uploadPdfApi(file, token, (percent) => {
          setUploadProgress(percent)
        })
        onUploadComplete(result.id, result.filename)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'PDF 업로드에 실패했습니다.')
        setSelectedFile(null)
      } finally {
        setIsUploading(false)
      }
    },
    [token, onUploadComplete]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file) {
        void handleFileSelect(file)
      }
    },
    [handleFileSelect]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        void handleFileSelect(file)
      }
    },
    [handleFileSelect]
  )

  const handleClick = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click()
    }
  }, [isUploading])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)}KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  return (
    <div className="space-y-3">
      {/* 드래그 영역 */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="PDF 파일 업로드 영역"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick()
          }
        }}
        className={`
          flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed
          px-6 py-10 text-center transition-colors
          ${isDragging
            ? 'border-[#1A1A1A] bg-gray-50'
            : 'border-[#E5E5E5] hover:border-[#999] hover:bg-gray-50'
          }
          ${isUploading ? 'cursor-not-allowed opacity-60' : ''}
        `}
      >
        {/* 업로드 아이콘 */}
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <svg
            className="h-6 w-6 text-[#666]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <p className="text-sm font-medium text-[#1A1A1A]">
          PDF 약관 파일을 여기에 드래그하거나 클릭하여 선택하세요
        </p>
        <p className="mt-1 text-xs text-[#666]">PDF 파일 최대 {MAX_FILE_SIZE_MB}MB</p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={handleInputChange}
          aria-label="PDF 파일 선택"
        />
      </div>

      {/* 선택된 파일 정보 */}
      {selectedFile && !error && (
        <div className="flex items-center gap-2 rounded-md border border-[#E5E5E5] px-3 py-2">
          <svg
            className="h-4 w-4 shrink-0 text-[#666]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span className="truncate text-sm text-[#1A1A1A]">{selectedFile.name}</span>
          <span className="shrink-0 text-xs text-[#666]">({formatFileSize(selectedFile.size)})</span>
        </div>
      )}

      {/* 업로드 진행률 */}
      {isUploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[#666]">
            <span>업로드 중...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E5E5]">
            <div
              className="h-full rounded-full bg-[#1A1A1A] transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
              role="progressbar"
              aria-valuenow={uploadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* 오류 메시지 */}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
