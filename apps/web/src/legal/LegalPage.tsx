import { legalNavigation, type LegalPage as LegalPageModel } from './legalPages';
import './legal.css';

export function LegalPage({ page }: { page: LegalPageModel }) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a className="legal-brand" href="/" aria-label="Runcast home">
          <img src="/runcast-mark.svg" alt="" aria-hidden="true" />
          <span>Runcast</span>
        </a>
        <a className="legal-contact" href="mailto:support@runcast.app">
          Contact support
        </a>
      </header>

      <main className="legal-main">
        <article className="legal-article">
          <p className="legal-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="legal-updated">Updated {page.updated}</p>
          <p className="legal-intro">{page.intro}</p>

          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>

        <nav className="legal-nav" aria-label="Runcast information">
          <p>Runcast information</p>
          {legalNavigation.map((item) => (
            <a
              key={item.path}
              href={item.path}
              aria-current={item.path === page.path ? 'page' : undefined}
            >
              {item.title}
            </a>
          ))}
        </nav>
      </main>

      <footer className="legal-footer">
        <span>See your run before you run it.</span>
        <span>© 2026 Runcast</span>
      </footer>
    </div>
  );
}
