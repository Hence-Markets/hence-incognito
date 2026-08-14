import { Link, Navigate, useParams } from 'react-router-dom';
import '../styles/legal.css';
import {
  HENCE_LEGAL_DOCUMENTS,
  HENCE_LEGAL_LINKS,
  type HenceLegalDocumentKey,
} from '../legal/content';
import { HenceLogo } from '../components/HenceLogo';

function isLegalDocumentKey(value: string | undefined): value is HenceLegalDocumentKey {
  return Boolean(value && value in HENCE_LEGAL_DOCUMENTS);
}

// Public legal pages (#/legal/terms|privacy|cookies) — the verbatim Hence legal
// bundle ported from the original app. Reachable signed-out; Privy links here for consent.
// these routes so the documents can always be read before accepting.
export default function Legal() {
  const { doc } = useParams<{ doc: string }>();

  if (!isLegalDocumentKey(doc)) {
    return <Navigate to={HENCE_LEGAL_LINKS.terms} replace />;
  }

  const page = HENCE_LEGAL_DOCUMENTS[doc];

  return (
    <div className="legal">
      <div className="legal-wrap">
        <Link to="/" className="legal-brand" aria-label="Back to Hence">
          <HenceLogo size={18} /> Hence
        </Link>
        <p className="legal-meta">Version {page.version} &middot; Updated {page.lastUpdated}</p>
        <h1 className="legal-title">{page.title}</h1>
        <p className="legal-sub">{page.subtitle}</p>
        <nav className="legal-tabs" aria-label="Legal documents">
          <Link to={HENCE_LEGAL_LINKS.terms} className={doc === 'terms' ? 'on' : ''}>Terms</Link>
          <Link to={HENCE_LEGAL_LINKS.privacy} className={doc === 'privacy' ? 'on' : ''}>Privacy</Link>
          <Link to={HENCE_LEGAL_LINKS.cookies} className={doc === 'cookies' ? 'on' : ''}>Cookies</Link>
        </nav>

        <div className="legal-card">
          {page.sections.map((section) => (
            <section key={section.heading} className="legal-sec">
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
