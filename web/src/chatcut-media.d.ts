import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "chatcut-media": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { slot?: string };
    }
  }
}
