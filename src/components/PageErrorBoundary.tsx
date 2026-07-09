import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.pageName ?? "Page"}] Error:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 flex flex-col items-center justify-center py-24 text-center">
          <AlertTriangle className="size-10 text-danger mb-4" />
          <div className="text-lg font-semibold">Something went wrong</div>
          <div className="text-[13px] text-muted-foreground mt-1 max-w-md">
            {this.props.pageName && `The ${this.props.pageName} page encountered an error. `}
            This has been logged. Try refreshing.
          </div>
          <pre className="mt-3 text-[11px] font-mono text-danger/70 bg-danger/5 rounded-md px-4 py-2 max-w-lg overflow-auto">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium"
          >
            <RefreshCw className="size-4" />Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}