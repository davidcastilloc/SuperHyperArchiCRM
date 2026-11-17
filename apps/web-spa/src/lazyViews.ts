import { lazy, type ComponentType } from 'react';
import type { Phase2ViewProps } from './views/phase2-format';

const lazyView = <K extends string>(
  loader: () => Promise<Record<K, ComponentType<Phase2ViewProps>>>,
  key: K,
) => lazy(() => loader().then((m) => ({ default: m[key] })));

export const DashboardView = lazy(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
export const SalesOrdersView = lazy(() => import('./views/SalesOrdersView').then((m) => ({ default: m.SalesOrdersView })));
export const DemoAndSopCenterView = lazy(() => import('./views/DemoAndSopCenterView').then((m) => ({ default: m.DemoAndSopCenterView })));
export const AppStoreView = lazy(() => import('./views/AppStoreView').then((m) => ({ default: m.AppStoreView })));
export const AuditLogsView = lazyView(() => import('./views/AuditLogsView'), 'AuditLogsView');
export const AutomationView = lazyView(() => import('./views/AutomationView'), 'AutomationView');
export const CatalogStructureView = lazyView(() => import('./views/CatalogStructureView'), 'CatalogStructureView');
export const ClaimsAndServicesView = lazyView(() => import('./views/ClaimsAndServicesView'), 'ClaimsAndServicesView');
export const ClinicalEhrView = lazyView(() => import('./views/ClinicalEhrView'), 'ClinicalEhrView');
export const CondoResidentHubView = lazyView(() => import('./views/CondoResidentHubView'), 'CondoResidentHubView');
export const CustomerTasksView = lazyView(() => import('./views/CustomerTasksView'), 'CustomerTasksView');
export const CustomFieldsView = lazyView(() => import('./views/CustomFieldsView'), 'CustomFieldsView');
export const DealsKanbanView = lazyView(() => import('./views/DealsKanbanView'), 'DealsKanbanView');
export const EudrComplianceView = lazyView(() => import('./views/EudrComplianceView'), 'EudrComplianceView');
export const FinanceView = lazyView(() => import('./views/FinanceView'), 'FinanceView');
export const FormsBuilderView = lazyView(() => import('./views/FormsBuilderView'), 'FormsBuilderView');
export const HeliosSecurityView = lazyView(() => import('./views/HeliosSecurityView'), 'HeliosSecurityView');
export const HospitalityPmsView = lazyView(() => import('./views/HospitalityPmsView'), 'HospitalityPmsView');
export const IamAdminView = lazyView(() => import('./views/IamAdminView'), 'IamAdminView');
export const IntegrationsHubView = lazyView(() => import('./views/IntegrationsHubView'), 'IntegrationsHubView');
export const LabelsAndFleetView = lazyView(() => import('./views/LabelsAndFleetView'), 'LabelsAndFleetView');
export const LegalPracticeView = lazyView(() => import('./views/LegalPracticeView'), 'LegalPracticeView');
export const CatalogView = lazyView(() => import('./views/CatalogView'), 'CatalogView');
export const PartiesView = lazyView(() => import('./views/PartiesView'), 'PartiesView');
export const PortalView = lazyView(() => import('./views/PortalView'), 'PortalView');
export const PosView = lazyView(() => import('./views/PosView'), 'PosView');
export const SmartCheckKioskView = lazyView(() => import('./views/SmartCheckKioskView'), 'SmartCheckKioskView');
export const WmsView = lazyView(() => import('./views/WmsView'), 'WmsView');
export const ProjectsBoardView = lazyView(() => import('./views/ProjectsBoardView'), 'ProjectsBoardView');
export const PromotionsView = lazyView(() => import('./views/PromotionsView'), 'PromotionsView');
export const QuotesView = lazyView(() => import('./views/QuotesView'), 'QuotesView');
export const StaffHubView = lazyView(() => import('./views/StaffHubView'), 'StaffHubView');
export const WmsLocationsView = lazyView(() => import('./views/WmsLocationsView'), 'WmsLocationsView');
export const WorkflowsVisualView = lazyView(() => import('./views/WorkflowsVisualView'), 'WorkflowsVisualView');
