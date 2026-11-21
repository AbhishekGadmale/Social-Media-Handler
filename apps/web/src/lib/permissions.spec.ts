import { describe, it, expect } from 'vitest';
import {
  canManageAccounts,
  canPublish,
  canApprove,
  canManageMembers,
  canManageBilling,
  canViewBilling,
  canManageBranding,
  canGenerateReports,
} from './permissions';

describe('Web Permissions Helpers (mirroring API PermissionMatrix)', () => {
  describe('canManageAccounts', () => {
    it('allows OWNER and MANAGER only', () => {
      expect(canManageAccounts('OWNER')).toBe(true);
      expect(canManageAccounts('MANAGER')).toBe(true);
      expect(canManageAccounts('EDITOR')).toBe(false);
      expect(canManageAccounts('CLIENT_APPROVER')).toBe(false);
      expect(canManageAccounts('VIEWER')).toBe(false);
      expect(canManageAccounts(null)).toBe(false);
      expect(canManageAccounts(undefined)).toBe(false);
      expect(canManageAccounts('UNKNOWN')).toBe(false);
    });
  });

  describe('canPublish', () => {
    it('allows OWNER, MANAGER, and EDITOR only', () => {
      expect(canPublish('OWNER')).toBe(true);
      expect(canPublish('MANAGER')).toBe(true);
      expect(canPublish('EDITOR')).toBe(true);
      expect(canPublish('CLIENT_APPROVER')).toBe(false);
      expect(canPublish('VIEWER')).toBe(false);
      expect(canPublish(null)).toBe(false);
      expect(canPublish(undefined)).toBe(false);
    });
  });

  describe('canApprove', () => {
    it('allows OWNER, MANAGER, and CLIENT_APPROVER only', () => {
      expect(canApprove('OWNER')).toBe(true);
      expect(canApprove('MANAGER')).toBe(true);
      expect(canApprove('CLIENT_APPROVER')).toBe(true);
      expect(canApprove('EDITOR')).toBe(false);
      expect(canApprove('VIEWER')).toBe(false);
      expect(canApprove(null)).toBe(false);
      expect(canApprove(undefined)).toBe(false);
    });
  });

  describe('canManageMembers', () => {
    it('allows OWNER and MANAGER only', () => {
      expect(canManageMembers('OWNER')).toBe(true);
      expect(canManageMembers('MANAGER')).toBe(true);
      expect(canManageMembers('EDITOR')).toBe(false);
      expect(canManageMembers('CLIENT_APPROVER')).toBe(false);
      expect(canManageMembers('VIEWER')).toBe(false);
      expect(canManageMembers(null)).toBe(false);
      expect(canManageMembers(undefined)).toBe(false);
    });
  });

  describe('canManageBilling', () => {
    it('allows OWNER only', () => {
      expect(canManageBilling('OWNER')).toBe(true);
      expect(canManageBilling('MANAGER')).toBe(false);
      expect(canManageBilling('EDITOR')).toBe(false);
      expect(canManageBilling('CLIENT_APPROVER')).toBe(false);
      expect(canManageBilling('VIEWER')).toBe(false);
      expect(canManageBilling(null)).toBe(false);
      expect(canManageBilling(undefined)).toBe(false);
    });
  });

  describe('canViewBilling', () => {
    it('allows OWNER, MANAGER, and EDITOR only (excludes CLIENT_APPROVER and VIEWER)', () => {
      expect(canViewBilling('OWNER')).toBe(true);
      expect(canViewBilling('MANAGER')).toBe(true);
      expect(canViewBilling('EDITOR')).toBe(true);
      expect(canViewBilling('CLIENT_APPROVER')).toBe(false);
      expect(canViewBilling('VIEWER')).toBe(false);
      expect(canViewBilling(null)).toBe(false);
      expect(canViewBilling(undefined)).toBe(false);
    });
  });

  describe('canManageBranding', () => {
    it('allows OWNER and MANAGER only', () => {
      expect(canManageBranding('OWNER')).toBe(true);
      expect(canManageBranding('MANAGER')).toBe(true);
      expect(canManageBranding('EDITOR')).toBe(false);
      expect(canManageBranding('CLIENT_APPROVER')).toBe(false);
      expect(canManageBranding('VIEWER')).toBe(false);
      expect(canManageBranding(null)).toBe(false);
      expect(canManageBranding(undefined)).toBe(false);
    });
  });

  describe('canGenerateReports', () => {
    it('allows OWNER, MANAGER, and EDITOR only', () => {
      expect(canGenerateReports('OWNER')).toBe(true);
      expect(canGenerateReports('MANAGER')).toBe(true);
      expect(canGenerateReports('EDITOR')).toBe(true);
      expect(canGenerateReports('CLIENT_APPROVER')).toBe(false);
      expect(canGenerateReports('VIEWER')).toBe(false);
      expect(canGenerateReports(null)).toBe(false);
      expect(canGenerateReports(undefined)).toBe(false);
    });
  });
});
