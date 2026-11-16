import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketVocabulary, TenantMarketProfile } from '@shac/kernel';
import { AuthBranchGate, ShacAppShell } from '../src/index.js';

afterEach(() => {
  cleanup();
});

const VOCAB: MarketVocabulary = {
  partySingular: 'Cliente',
  partyPlural: 'Clientes',
  orderSingular: 'Ticket de Venta',
  branchSingular: 'Tienda',
  spaceSingular: 'Caja',
  caseSingular: 'Reclamo',
};

const PROFILE: Pick<
  TenantMarketProfile,
  'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
> = {
  tenantId: 'ten_demo',
  editionPreset: 'retail-pos',
  activeModules: ['iam', 'pos'],
  vocabulary: VOCAB,
};

describe('@shac/ui smoke tests', () => {
  it('renders AuthBranchGate with branch selector and 56px (min-h-14) 6-digit PIN keypad', () => {
    const onSelectBranch = vi.fn();
    const onPinSubmit = vi.fn();

    const { container } = render(
      <AuthBranchGate
        vocabulary={VOCAB}
        branches={[
          { id: 'br_1', name: 'Sede Centro', orgPath: '/root/centro' },
          { id: 'br_2', name: 'Sede Norte', orgPath: '/root/norte' },
        ]}
        selectedBranchId="br_1"
        onSelectBranch={onSelectBranch}
        onPinSubmit={onPinSubmit}
      />,
    );

    const gate = container.querySelector('[data-slot="auth-branch-gate"]');
    expect(gate).toHaveAttribute('data-density', 'touch');

    const branchSelect = screen.getByLabelText('Tienda');
    expect(branchSelect).toBeInTheDocument();
    fireEvent.change(branchSelect, { target: { value: 'br_2' } });
    expect(onSelectBranch).toHaveBeenCalledWith('br_2');

    const pinSlots = container.querySelectorAll('[data-slot="pin-slot"]');
    expect(pinSlots).toHaveLength(6);

    const key1 = screen.getByRole('button', { name: '1' });
    expect(key1.className).toContain('min-h-14');

    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar PIN' }));
    expect(onPinSubmit).toHaveBeenCalledWith({
      pin: '123456',
      branchId: 'br_1',
      mode: 'delegation',
    });
  });

  it('renders ShacAppShell with SyncStatusPill, bimodal density, dark mode, and module filtering', () => {
    const { container, rerender } = render(
      <ShacAppShell
        profile={PROFILE}
        branchName="Sede Centro"
        density="compact"
        theme="light"
        syncState={{ status: 'online' }}
        navItems={[
          { id: 'iam', label: 'Accesos', href: '/iam', moduleId: 'iam' },
          { id: 'pos', label: 'POS Táctil', href: '/pos', moduleId: 'pos', shortcut: 'F2' },
          { id: 'wms', label: 'Almacén', href: '/wms', moduleId: 'wms' },
        ]}
      >
        <div>Contenido principal</div>
      </ShacAppShell>,
    );

    const shell = container.querySelector('[data-slot="app-shell"]');
    expect(shell).toHaveAttribute('data-density', 'compact');
    expect(shell).not.toHaveClass('dark');
    expect(screen.getByText('En línea · Tiempo real')).toBeInTheDocument();
    expect(screen.getByText('POS Táctil')).toBeInTheDocument();
    expect(screen.queryByText('Almacén')).not.toBeInTheDocument();

    rerender(
      <ShacAppShell
        profile={PROFILE}
        branchName="Sede Centro"
        density="touch"
        theme="dark"
        syncState={{ status: 'offline', pendingMutations: 3 }}
        navItems={[{ id: 'pos', label: 'POS Táctil', href: '/pos', moduleId: 'pos' }]}
      >
        <div>Contenido principal</div>
      </ShacAppShell>,
    );

    expect(shell).toHaveAttribute('data-density', 'touch');
    expect(shell).toHaveClass('dark');
    expect(screen.getByText('Offline · 3 mutaciones en cola')).toBeInTheDocument();
  });

  it('renders ported Open Mercato primitives: KpiCard, EmptyState, SectionHeader, and RowActions', async () => {
    const { KpiCard, EmptyState, SectionHeader, RowActions } = await import('../src/index.js');
    const onAction = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <div>
        <KpiCard title="Pipeline Abierto" value="$1,250.00" trend={{ value: 12, direction: 'up' }} />
        <SectionHeader title="Oportunidades" count={3} />
        <EmptyState title="Sin registros" actionLabel="Crear" onAction={onAction} />
        <RowActions items={[{ id: 'open', label: 'Abrir ficha', onSelect }]} />
      </div>,
    );
    expect(container.querySelector('[data-slot="kpi-card"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="section-header"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="empty-state"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="row-actions"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir ficha' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders FilterBar and sortable DataTable with EmptyState fallback', async () => {
    const { FilterBar, DataTable } = await import('../src/index.js');
    const onSearchChange = vi.fn();
    const onSelectChip = vi.fn();
    const onRowClick = vi.fn();
    const rows = [
      { id: '1', name: 'Zeta Corp', score: 20 },
      { id: '2', name: 'Alfa S.A.', score: 50 },
    ];
    const columns = [
      { id: 'name', header: 'Nombre', cell: (r: (typeof rows)[number]) => r.name, sortValue: (r: (typeof rows)[number]) => r.name },
      { id: 'score', header: 'Puntos', cell: (r: (typeof rows)[number]) => r.score, sortValue: (r: (typeof rows)[number]) => r.score },
    ];

    const { rerender, container } = render(
      <div>
        <FilterBar
          searchValue=""
          onSearchChange={onSearchChange}
          chips={[{ id: 'all', label: 'Todos', count: 2 }]}
          activeChipId="all"
          onSelectChip={onSelectChip}
        />
        <DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />
      </div>,
    );

    expect(container.querySelector('[data-slot="filter-bar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="data-table"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nombre/i }));
    const firstBodyCell = container.querySelector('tbody tr td');
    expect(firstBodyCell?.textContent).toBe('Alfa S.A.');

    fireEvent.click(screen.getByText('Alfa S.A.'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);

    rerender(<DataTable columns={columns} data={[]} getRowId={(r) => r.id} emptyTitle="Sin clientes" />);
    expect(screen.getByText('Sin clientes')).toBeInTheDocument();
  });

  it('groups ShacAppShell nav items into collapsible sections and filters them via sidebar search', () => {
    render(
      <ShacAppShell
        profile={PROFILE}
        branchName="Casa Matriz"
        syncState={{ status: 'online' }}
        navItems={[
          { id: 'parties', label: 'Clientes', href: '/parties', group: 'CUSTOMERS', moduleId: 'iam' },
          { id: 'pos', label: 'POS · Pedido', href: '/pos', group: 'SALES', moduleId: 'pos', shortcut: 'F2' },
        ]}
      >
        <div>Dashboard</div>
      </ShacAppShell>,
    );

    expect(screen.getByText('CUSTOMERS')).toBeInTheDocument();
    expect(screen.getByText('SALES')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Buscar menú...');
    fireEvent.change(searchInput, { target: { value: 'POS' } });
    expect(screen.getByText('POS · Pedido')).toBeInTheDocument();
    expect(screen.queryByText('Clientes')).not.toBeInTheDocument();
  });

  it('renders Open Mercato DS v3 StatusBadge (pill and dot) and PageHeader with refresh action', async () => {
    const uiModule = await import('../src/index.js');
    expect('StatusBadge' in uiModule).toBe(true);
    expect('PageHeader' in uiModule).toBe(true);
    const { StatusBadge, PageHeader } = uiModule as typeof import('../src/index.js') & {
      StatusBadge: React.ComponentType<{ label: string; tone?: 'success' | 'warning' | 'error' | 'info' | 'neutral'; appearance?: 'pill' | 'dot' }>;
      PageHeader: React.ComponentType<{ title: string; description?: string; onRefresh?: () => void }>;
    };
    const onRefresh = vi.fn();
    const { container } = render(
      <div>
        <PageHeader title="Sales orders" description="Review documents" onRefresh={onRefresh} />
        <StatusBadge label="Fulfilled" tone="success" appearance="dot" />
        <StatusBadge label="Active" tone="success" appearance="pill" />
      </div>,
    );

    expect(container.querySelector('[data-slot="page-header"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="status-badge"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('opens CommandPalette via Ctrl+K in ShacAppShell and renders SavedViewsBar with CSV export', async () => {
    const uiModule = await import('../src/index.js');
    expect('SavedViewsBar' in uiModule).toBe(true);
    expect('toCsvString' in uiModule).toBe(true);
    const { SavedViewsBar, toCsvString } = uiModule as typeof import('../src/index.js') & {
      SavedViewsBar: React.ComponentType<{
        views: Array<{ id: string; label: string }>;
        activeViewId: string;
        onSelectView: (id: string) => void;
        onExport?: () => void;
      }>;
      toCsvString: (headers: string[], rows: Array<Array<string | number>>) => string;
    };

    const onNavigate = vi.fn();
    const onSelectView = vi.fn();
    const onExport = vi.fn();

    render(
      <div>
        <ShacAppShell
          profile={PROFILE}
          branchName="Casa Matriz"
          syncState={{ status: 'online' }}
          onNavigate={onNavigate}
          navItems={[
            { id: 'pos', label: 'POS · Pedido', href: '/pos', group: 'SALES', moduleId: 'pos' },
          ]}
        >
          <SavedViewsBar
            views={[
              { id: 'all', label: 'Todas las vistas' },
              { id: 'fulfilled', label: 'Completadas' },
            ]}
            activeViewId="all"
            onSelectView={onSelectView}
            onExport={onExport}
          />
        </ShacAppShell>
      </div>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const paletteInput = screen.getByPlaceholderText(/Ir a pantalla o buscar comando/i);
    expect(paletteInput).toBeInTheDocument();
    fireEvent.change(paletteInput, { target: { value: 'POS' } });
    fireEvent.click(screen.getByRole('option', { name: /POS · Pedido/i }));
    expect(onNavigate).toHaveBeenCalledWith('/pos');

    fireEvent.click(screen.getByRole('button', { name: /Exportar/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(toCsvString(['Order', 'Total'], [['ORD-1', 150]])).toContain('ORD-1,150');
  });
});
