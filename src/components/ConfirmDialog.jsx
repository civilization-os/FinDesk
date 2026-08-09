import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function ConfirmDialog({ open, eyebrow = 'CONFIRM ACTION', title, description, confirmText = '确认', cancelText = '取消', tone = 'danger', onConfirm, onCancel }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    cancelRef.current?.focus()
    const handleKey = (event) => {
      if (event.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div className="confirm-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel?.()}>
      <section className={`confirm-dialog ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <div className="confirm-mark" aria-hidden="true">!</div>
        <div className="confirm-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h3 id="confirm-title">{title}</h3>
          <p id="confirm-description">{description}</p>
        </div>
        <div className="confirm-actions">
          <button ref={cancelRef} className="confirm-cancel" type="button" onClick={onCancel}>{cancelText}</button>
          <button className="confirm-submit" type="button" onClick={onConfirm}>{confirmText}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
