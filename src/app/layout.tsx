import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import 'katex/dist/katex.min.css';

export const metadata: Metadata = {
  title: 'Math Tutor',
  description: 'AI-powered Socratic math tutor with freehand canvas',
};

// In the Android app (npm run build:android) every page load of a path without an extension gets
// index.html, which is Home. So a full load of /board (say, a reload) goes to /board.html instead,
// which then shows /board in the address again before the app starts.
const ANDROID_PAGE_LOAD = `(function () {
  var path = location.pathname, rest = location.search + location.hash;
  if (/\\.html$/.test(path)) history.replaceState(null, '', (path === '/index.html' ? '/' : path.slice(0, -5)) + rest);
  else if (path !== '/') location.replace(path.replace(/\\/$/, '') + '.html' + rest);
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {process.env.BUILD_TARGET === 'android' && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: ANDROID_PAGE_LOAD }} />
        </head>
      )}
      <body className={`${GeistSans.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
