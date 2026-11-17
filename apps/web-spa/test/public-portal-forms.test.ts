import { describe, expect, it } from 'vitest';
import { normalizeFormFields } from '../src/views/PublicFormAndQuoteView';

describe('PublicFormAndQuoteView normalizeFormFields', () => {
  it('converts string arrays into FormFieldSpec objects with unique names and inferred types', () => {
    const fields = normalizeFormFields('{"fields":["Nombre Completo","Correo Electrónico","Teléfono","Mensaje"]}');
    expect(fields).toEqual([
      { name: 'nombre_completo', label: 'Nombre Completo', type: 'text', required: true },
      { name: 'correo_electronico', label: 'Correo Electrónico', type: 'email', required: true },
      { name: 'telefono', label: 'Teléfono', type: 'tel', required: true },
      { name: 'mensaje', label: 'Mensaje', type: 'textarea', required: true },
    ]);
  });

  it('preserves structured FormFieldSpec objects identically', () => {
    const fields = normalizeFormFields('{"fields":[{"name":"rif","label":"RIF","type":"text","required":true}]}');
    expect(fields).toEqual([{ name: 'rif', label: 'RIF', type: 'text', required: true }]);
  });
});
