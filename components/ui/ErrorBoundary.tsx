"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="bg-bg-panel border border-status-alert/20 rounded-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-status-alert" />
            <span className="text-sm font-medium text-status-alert">
              Component Error
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Something went wrong rendering this section.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1 text-xs bg-bg-card border border-border rounded hover:border-border-hover transition-colors text-text-secondary"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
