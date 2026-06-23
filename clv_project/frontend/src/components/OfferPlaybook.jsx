/**
 * OfferPlaybook.jsx — Phase 2E
 *
 * Product category lift vs. baseline for each customer segment.
 * Lift > 1.0 = over-indexed vs. the overall mix — prioritise these SKUs and
 * creatives when running segment-targeted campaigns.
 *
 * Graceful fallback when product_category is absent from the CRM.
 *
 * Props:
 *   offerPlaybook : results.offer_playbook  (list or null)
 */

const SEGMENT_LABEL = {
  high_potential: 'High Potential',
  loyal:          'Loyal',
  at_risk:        'At Risk',
  low_value:      'Low Value',
};

const SEGMENT_COLOR = {
  high_potential: '#1D9E75',
  loyal:          '#378ADD',
  at_risk:        '#BA7517',
  low_value:      '#888780',
};

function LiftBar({ lift, maxLift }) {
  const pct   = Math.min((lift / maxLift) * 100, 100);
  const color = lift >= 1.2 ? '#1D9E75' : lift >= 0.9 ? '#378ADD' : '#BA7517';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 6, borderRadius: 3,
        background: 'var(--color-border-tertiary)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3,
          background: color, transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color, minWidth: 34, textAlign: 'right' }}>
        {lift.toFixed(2)}×
      </span>
    </div>
  );
}

export default function OfferPlaybook({ offerPlaybook }) {
  if (!offerPlaybook) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
        Product category data not found in CRM. Upload a CRM file with a{' '}
        <code style={{ fontSize: 12, background: 'var(--color-background-secondary)', padding: '1px 5px', borderRadius: 4 }}>
          product_category
        </code>{' '}
        column to unlock offer recommendations.
      </div>
    );
  }

  const maxLift = Math.max(
    ...offerPlaybook.flatMap(s => s.categories.map(c => c.lift)),
    1.5,
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
      {offerPlaybook.map(seg => (
        <div key={seg.segment} style={{
          padding: '12px 14px',
          borderRadius: 'var(--border-radius-md)',
          background: 'var(--color-background-secondary)',
          borderTop: `3px solid ${SEGMENT_COLOR[seg.segment]}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: SEGMENT_COLOR[seg.segment], marginBottom: 10,
          }}>
            {SEGMENT_LABEL[seg.segment]}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {seg.categories.map(cat => (
              <div key={cat.category}>
                <div style={{ fontSize: 11, color: 'var(--color-text-primary)', marginBottom: 4, textTransform: 'capitalize' }}>
                  {cat.category.replace(/_/g, ' ')}
                </div>
                <LiftBar lift={cat.lift} maxLift={maxLift} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 9, fontSize: 10, color: 'var(--color-text-secondary)' }}>
            Lift vs. baseline · &gt;1.0 = over-indexed
          </div>
        </div>
      ))}
    </div>
  );
}
