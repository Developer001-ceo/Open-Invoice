'use client';

/**
 * Injects navbar styles as a client-side <style> tag.
 *
 * Why a client component? Next.js 16 App Router strips inline <style> tags
 * from server component output, and Tailwind v4 tree-shakes custom CSS
 * classes out of globals.css. A client component's <style> tag survives both.
 */
export function NavbarStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
/* ── Menu triggers (File / Edit / View) — animated black→pink underline ── */
.nav-btn-pink{
  position:relative;
  transition:color .28s ease;
}
.nav-btn-pink::after{
  content:"";
  position:absolute;
  left:10%;
  right:10%;
  bottom:1px;
  height:2px;
  border-radius:2px;
  background:linear-gradient(90deg,#1a1a1a 0%,#ec4899 100%);
  transform:scaleX(0);
  transform-origin:left center;
  transition:transform .34s cubic-bezier(.22,1,.36,1);
}
.nav-btn-pink::before{
  content:"";
  position:absolute;
  left:15%;
  right:15%;
  bottom:0;
  height:6px;
  border-radius:4px;
  background:radial-gradient(60% 100% at 50% 100%,rgba(236,72,153,.22),transparent 80%);
  opacity:0;
  transition:opacity .34s ease;
  pointer-events:none;
}
.nav-btn-pink:hover{ color:#be185d; }
.nav-btn-pink:hover::after{ transform:scaleX(1); }
.nav-btn-pink:hover::before{ opacity:1; }
.nav-btn-pink:focus-visible{
  outline:2px solid rgba(236,72,153,.45);
  outline-offset:2px;
  border-radius:4px;
}

/* ── Bookmark-style buttons (Settings / Preview) — Uiverse design ────────
   Dark→pink gradient. On hover the icon circle expands and the text
   collapses; on click the whole button scales down.                        */
.bookmark-btn{
  position:relative;
  width:88px;
  height:34px;
  border-radius:40px;
  border:1px solid rgba(236,72,153,.25);
  background:linear-gradient(135deg,#1a1a1a 0%,#2d1b2e 50%,#0c0c0c 100%);
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  transition-duration:.3s;
  transition-property:transform,box-shadow,border-color;
  overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.15);
}
.bookmark-btn:hover{
  border-color:rgba(236,72,153,.5);
  box-shadow:0 4px 14px -4px rgba(236,72,153,.4),0 0 0 1px rgba(236,72,153,.15);
}
.bookmark-btn__icon-container{
  width:24px;
  height:24px;
  background:linear-gradient(135deg,#1a1a1a 0%,#be185d 55%,#ec4899 100%);
  border-radius:50px;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  z-index:2;
  transition-duration:.3s;
  flex-shrink:0;
  box-shadow:0 0 8px -2px rgba(236,72,153,.5);
}
.bookmark-btn__icon{
  display:flex;
  align-items:center;
  justify-content:center;
  color:#fff;
}
.bookmark-btn__icon svg{
  width:14px;
  height:14px;
}
.bookmark-btn__text{
  height:100%;
  width:52px;
  display:flex;
  align-items:center;
  justify-content:center;
  color:#fce7f3;
  z-index:1;
  transition-duration:.3s;
  font-size:11px;
  font-weight:500;
  letter-spacing:.02em;
  white-space:nowrap;
}
.bookmark-btn:hover .bookmark-btn__icon-container{
  width:68px;
  transition-duration:.3s;
}
.bookmark-btn:hover .bookmark-btn__text{
  transform:translate(8px);
  width:0;
  font-size:0;
  opacity:0;
  transition-duration:.3s;
}
.bookmark-btn:active{
  transform:scale(.95);
  transition-duration:.3s;
}
.bookmark-btn:focus-visible{
  outline:2px solid rgba(236,72,153,.5);
  outline-offset:2px;
}
    `}} />
  );
}
