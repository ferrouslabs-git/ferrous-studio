// One component's render, fenced off. The studio has no error boundary above
// it, so before this a single throw inside Schematic — an unexpected shape in
// a page document, a catalogue type the renderer has no branch for — unmounted
// the whole app and left a blank screen with nothing to click. A page document
// is data we did not write (imports, bundles from agents, older documents), so
// the renderer meeting something it cannot draw is a normal event, not a bug
// in the app, and it should cost one component rather than the session.
//
// Deliberately per component, not per page: the rest of the page still draws,
// so the placeholder says which component failed and where to look.
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  cmpId: string;
  cmpType: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class CmpBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown, info: ErrorInfo) {
    // Keep the stack in the console: the placeholder is for the person, this
    // is for whoever they report it to.
    console.error(`Component ${this.props.cmpId} (${this.props.cmpType}) failed to render`, err, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // A different component in the same slot deserves a fresh attempt. An
    // edit to the SAME component does not retry automatically — re-rendering
    // the thing that just threw would throw again on every keystroke — so
    // that path is the explicit Try again below.
    if (prev.cmpId !== this.props.cmpId && this.state.message !== null) this.setState({ message: null });
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="cmp-broken" role="alert">
        <strong>This {this.props.cmpType} could not be drawn.</strong>
        <span className="cmp-broken-why">{this.state.message}</span>
        <button type="button" onClick={() => this.setState({ message: null })}>
          Try again
        </button>
      </div>
    );
  }
}
