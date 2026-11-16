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
});
