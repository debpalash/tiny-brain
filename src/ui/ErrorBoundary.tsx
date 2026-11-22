import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="ui-fallback" role="alert">
          <p>The {this.props.label} could not be shown.</p>
          <button className="ui-btn" type="button" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
