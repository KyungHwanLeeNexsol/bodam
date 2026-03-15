'use client'

/**
 * 이메일 입력 다이얼로그 컴포넌트 (SPEC-OAUTH-001)
 *
 * 카카오 등 제공자에서 이메일 정보를 제공하지 않는 경우 렌더링.
 * 사용자에게 이메일 주소를 직접 입력받음.
 */

import React, { useState } from 'react'
import { z } from 'zod'

interface EmailInputDialogProps {
  /** 이메일 제출 콜백 */
  onSubmit: (email: string) => void | Promise<void>
  /** 취소 콜백 */
  onCancel: () => void
  /** 제출 중 로딩 상태 (외부 제어) */
  isLoading?: boolean
}

// 이메일 유효성 스키마
const emailSchema = z.string().min(1, '이메일을 입력해주세요.').email('유효한 이메일 주소를 입력해주세요.')

/**
 * EmailInputDialog 컴포넌트
 *
 * 카카오 계정에서 이메일을 제공하지 않을 때 사용자에게 이메일 입력 요청.
 * onSubmit 콜백으로 입력된 이메일 전달.
 */
export function EmailInputDialog({ onSubmit, onCancel, isLoading = false }: EmailInputDialogProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // 클라이언트 유효성 검사
    const result = emailSchema.safeParse(email)
    if (!result.success) {
      const issues = result.error.issues
      setError(issues[0]?.message ?? '이메일을 확인해주세요.')
      return
    }

    await onSubmit(email)
  }

  return (
    // 다이얼로그 오버레이
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white px-6 py-8 shadow-lg">
        <h2 className="mb-2 text-lg font-semibold text-[#1A1A1A]">이메일 주소 입력</h2>
        <p className="mb-6 text-sm text-[#666]">
          카카오 계정에서 이메일 정보를 제공하지 않았습니다.
          <br />
          서비스 이용을 위해 이메일 주소를 입력해주세요.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="dialog-email" className="block text-sm font-medium text-[#1A1A1A]">
              이메일
            </label>
            <input
              id="dialog-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#999] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
              placeholder="example@email.com"
              disabled={isLoading}
            />
            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 rounded-md border border-[#E5E5E5] py-2.5 text-sm font-medium text-[#1A1A1A] transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 rounded-md bg-[#1A1A1A] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {isLoading ? '처리 중...' : '확인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
