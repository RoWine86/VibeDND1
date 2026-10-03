// ─── Глобальный перехватчик ошибок рендера ───────────────────────────────────
// Без него любая ошибка в render() размонтирует всё дерево React и оставляет
// пустую чёрную страницу — пользователь не понимает, что произошло. Здесь мы
// показываем причину и даём кнопки восстановления.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('VibeDND: ошибка рендера', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private resetSession = () => {
    localStorage.removeItem('vibednd.dmSession');
    window.location.href = '/dm';
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 16px' }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Что-то пошло не так</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Приложение упало при отрисовке экрана. Ниже — причина; это поможет
            понять, что случилось.
          </p>
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--crimson)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              color: '#f0a0a6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {err.message}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="primary" onClick={this.reset}>
              Попробовать ещё раз
            </button>
            <button onClick={() => window.location.reload()}>Перезагрузить страницу</button>
            <button onClick={this.resetSession}>Сбросить сессию мастера</button>
          </div>
        </div>
      </div>
    );
  }
}
