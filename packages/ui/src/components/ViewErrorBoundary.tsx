import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ViewErrorBoundaryProps {
  readonly viewId: string;
  readonly children: ReactNode;
  readonly onResetView?: (viewId: string) => void;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ViewErrorBoundary extends Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  override state: ViewErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): ViewErrorBoundaryState {
    return {
      hasError: true,
      errorMessage:
        error instanceof Error ? error.message : 'Unexpected view rendering error',
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      `[SHAC ViewErrorBoundary:${this.props.viewId}]`,
      error,
      info.componentStack,
    );
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onResetView?.(this.props.viewId);
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        data-testid={`view-error-boundary-${this.props.viewId}`}
        className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-6 text-sm"
      >
        <h3 className="font-semibold text-amber-300">
          Módulo aislado por seguridad ({this.props.viewId})
        </h3>
        <p className="mt-1 text-slate-300">{this.state.errorMessage}</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-4 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-slate-950 hover:bg-amber-400"
        >
          Reintentar módulo
        </button>
      </div>
    );
  }
}
