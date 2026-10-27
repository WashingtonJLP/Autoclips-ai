import './globals.css';
export const metadata = {
  title: 'AutoClips AI',
  description: 'Produção responsável de vídeos curtos',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
