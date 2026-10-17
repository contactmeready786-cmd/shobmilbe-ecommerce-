// The pages write a few attributes in lower case, exactly as the old HTML had them. React writes a name as it is given
// (fetchPriority="high" would come out with a capital P, and React 19 would add a preload <link> for it), so these
// stay lower case to keep every page's HTML the same. This only tells TypeScript the lower-case names are allowed.
import 'react';

declare module 'react' {
  interface HTMLAttributes<T> {
    spellcheck?: 'true' | 'false';
  }
  interface ImgHTMLAttributes<T> {
    fetchpriority?: 'high' | 'low' | 'auto';
  }
  interface IframeHTMLAttributes<T> {
    srcdoc?: string;
  }
  interface InputHTMLAttributes<T> {
    maxlength?: string | number;
  }
}
