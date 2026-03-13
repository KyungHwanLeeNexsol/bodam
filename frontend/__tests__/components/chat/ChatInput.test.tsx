import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ChatInput from '@/components/chat/ChatInput'

describe('ChatInput', () => {
  describe('기본 렌더링', () => {
    it('텍스트 입력 영역을 렌더링한다', () => {
      render(<ChatInput onSend={vi.fn()} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('전송 버튼을 렌더링한다', () => {
      render(<ChatInput onSend={vi.fn()} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('메시지 전송', () => {
    it('Enter 키를 누르면 onSend를 호출한다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '테스트 메시지' } })
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
      expect(onSend).toHaveBeenCalledWith('테스트 메시지')
    })

    it('Enter 키 전송 후 입력창이 비워진다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: '테스트 메시지' } })
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
      expect(textarea.value).toBe('')
    })

    it('Shift+Enter는 줄바꿈을 추가하고 전송하지 않는다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '테스트 메시지' } })
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true })
      expect(onSend).not.toHaveBeenCalled()
    })

    it('빈 메시지를 전송하지 않는다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '   ' } })
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
      expect(onSend).not.toHaveBeenCalled()
    })

    it('전송 버튼 클릭으로 메시지를 전송한다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '버튼 전송 테스트' } })
      fireEvent.click(screen.getByRole('button'))
      expect(onSend).toHaveBeenCalledWith('버튼 전송 테스트')
    })
  })

  describe('글자 수 제한', () => {
    it('4000자 초과 시 글자 수 카운터를 표시한다', () => {
      render(<ChatInput onSend={vi.fn()} />)
      const textarea = screen.getByRole('textbox')
      const longText = 'a'.repeat(4001)
      fireEvent.change(textarea, { target: { value: longText } })
      expect(screen.getByText(/4001/)).toBeInTheDocument()
    })

    it('4000자 이하일 때 글자 수 카운터를 표시하지 않는다', () => {
      render(<ChatInput onSend={vi.fn()} />)
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '짧은 메시지' } })
      expect(screen.queryByText(/\/5000/)).not.toBeInTheDocument()
    })

    it('5000자를 초과하는 입력을 허용하지 않는다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} />)
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      const tooLongText = 'a'.repeat(5001)
      fireEvent.change(textarea, { target: { value: tooLongText } })
      // 5000자까지만 허용하거나 전송 불가
      expect(textarea.value.length).toBeLessThanOrEqual(5000)
    })
  })

  describe('비활성화 상태', () => {
    it('disabled 시 입력창이 비활성화된다', () => {
      render(<ChatInput onSend={vi.fn()} disabled />)
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea.disabled).toBe(true)
    })

    it('disabled 시 전송 버튼이 비활성화된다', () => {
      render(<ChatInput onSend={vi.fn()} disabled />)
      const button = screen.getByRole('button') as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })

    it('disabled 시 Enter 키로 전송하지 않는다', () => {
      const onSend = vi.fn()
      render(<ChatInput onSend={onSend} disabled />)
      const textarea = screen.getByRole('textbox')
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
      expect(onSend).not.toHaveBeenCalled()
    })
  })
})
