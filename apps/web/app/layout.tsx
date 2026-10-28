import './globals.css';
import Shell from './components/shell';
export const metadata = {
  title: 'AutoClips AI',
  description: 'Produção responsável de vídeos curtos',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
