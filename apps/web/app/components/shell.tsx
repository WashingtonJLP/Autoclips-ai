'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Icon from './glyph';
export const navigation = [
  ['/', 'Visão geral', 'overview'],
  ['/criar', 'Criar cortes', 'create'],
  ['/biblioteca', 'Biblioteca', 'library'],
  ['/publicacoes', 'Publicações', 'publish'],
  ['/fontes', 'Fontes', 'sources'],
  ['/configuracoes', 'Configurações', 'settings'],
] as const;
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    [open, setOpen] = useState(false),
    [mobile, setMobile] = useState(false);
  const sidebar = useRef<HTMLElement>(null),
    menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (open && mobile)
      sidebar.current?.querySelector<HTMLAnchorElement>('nav a')?.focus();
  }, [open, mobile]);
  function closeMenu() {
    setOpen(false);
    menu.current?.focus();
  }
  return (
    <div className="app-shell">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="mobile-header">
        <Link href="/" className="brand" prefetch={false}>
          <span className="brand-mark">
            <Icon name="video" />
          </span>
          AutoClips <b>AI</b>
        </Link>
        <button
          ref={menu}
          className="icon-button"
          aria-label={open ? 'Fechar navegação' : 'Abrir navegação'}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'close' : 'menu'} />
        </button>
      </header>
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Fechar navegação"
          onClick={closeMenu}
        />
      )}
      <aside
        ref={sidebar}
        id="sidebar"
        inert={mobile && !open ? true : undefined}
        className={`sidebar ${open ? 'is-open' : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeMenu();
          if (mobile && open && e.key === 'Tab') {
            const links =
              sidebar.current?.querySelectorAll<HTMLAnchorElement>('nav a');
            const first = links?.[0],
              last = links?.[links.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <Link
          href="/"
          className="brand"
          prefetch={false}
          onClick={() => setOpen(false)}
        >
          <span className="brand-mark">
            <Icon name="video" />
          </span>
          AutoClips <b>AI</b>
        </Link>
        <p className="nav-caption">ESTÚDIO</p>
        <nav aria-label="Navegação principal">
          {navigation.map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={pathname === href ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {pathname === href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Ambiente local
          <p>Produza com direitos verificados.</p>
          <span className="badge warning">Publicação simulada</span>
        </div>
      </aside>
      <div className="workspace" inert={mobile && open ? true : undefined}>
        <header className="workspace-bar">
          <span>
            Workspace <span className="muted">/</span>{' '}
            <strong>
              {navigation.find(([href]) => href === pathname)?.[1] ??
                'AutoClips AI'}
            </strong>
          </span>
          <span className="workspace-user">
            <span className="avatar">OP</span>Operador
          </span>
        </header>
        <main id="conteudo" className="page-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          AutoClips AI <span>Conteúdo autorizado. Novas possibilidades.</span>
        </footer>
      </div>
    </div>
  );
}
