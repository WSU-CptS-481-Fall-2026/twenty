import gql from 'graphql-tag';
import { expectOneNotInternalServerErrorSnapshot } from 'test/integration/graphql/utils/expect-one-not-internal-server-error-snapshot.util';
import { resendWorkspaceInvitationOperationFactory } from 'test/integration/graphql/utils/resend-workspace-invitation-operation-factory.util';
import {
  deleteWorkspaceInvitationsByEmail,
  findWorkspaceInvitationsByEmail,
  seedWorkspaceInvitation,
} from 'test/integration/graphql/utils/seed-workspace-invitation.util';
import { sendInvitationsOperationFactory } from 'test/integration/graphql/utils/send-invitations-operation-factory.util';
import { signUpInWorkspaceOperationFactory } from 'test/integration/graphql/utils/sign-up-in-workspace-operation-factory.util';
import { findRoles } from 'test/integration/metadata/suites/role/utils/find-roles.util';
import { makeMetadataAPIRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { jestExpectToBeDefined } from 'test/utils/jest-expect-to-be-defined.util.test';
import { v4 } from 'uuid';

import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const ONE_HOUR_IN_MS = 60 * 60 * 1000;
const JANE_EMAIL = 'jane.austen@apple.dev';

const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;

const findWorkspaceInvitationsOperation = {
  query: gql`
    query FindWorkspaceInvitations {
      findWorkspaceInvitations {
        id
        email
        roleId
      }
    }
  `,
};

const deleteWorkspaceInvitationOperationFactory = (appTokenId: string) => ({
  query: gql`
    mutation DeleteWorkspaceInvitation($appTokenId: String!) {
      deleteWorkspaceInvitation(appTokenId: $appTokenId)
    }
  `,
  variables: { appTokenId },
});

const findSignUpWorkspacesOperation = {
  query: gql`
    query CurrentUserAvailableWorkspaces {
      currentUser {
        availableWorkspaces {
          availableWorkspacesForSignUp {
            id
          }
        }
      }
    }
  `,
};

const seedValidInvitation = (email: string) =>
  seedWorkspaceInvitation({
    email,
    value: `${email}-token`,
    expiresAt: new Date(Date.now() + ONE_HOUR_IN_MS),
  });

describe('workspace invitation lifecycle (integration)', () => {
  it('lists pending invitations of the workspace', async () => {
    const email = uniqueEmail('list-invitation');
    const appTokenId = await seedValidInvitation(email);

    try {
      const response = await makeMetadataAPIRequest(
        findWorkspaceInvitationsOperation,
      );

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.findWorkspaceInvitations).toContainEqual({
        id: appTokenId,
        email,
        roleId: null,
      });
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email });
    }
  });

  it('deletes an existing invitation', async () => {
    const email = uniqueEmail('delete-invitation');
    const appTokenId = await seedValidInvitation(email);

    try {
      const response = await makeMetadataAPIRequest(
        deleteWorkspaceInvitationOperationFactory(appTokenId),
      );

      expect(response.body.data.deleteWorkspaceInvitation).toBe('success');
      expect(await findWorkspaceInvitationsByEmail({ email })).toHaveLength(0);
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email });
    }
  });

  it('reports an error when deleting an unknown invitation', async () => {
    const response = await makeMetadataAPIRequest(
      deleteWorkspaceInvitationOperationFactory(v4()),
    );

    expect(response.body.data.deleteWorkspaceInvitation).toBe('error');
  });

  it('replaces the token when resending an invitation', async () => {
    const email = uniqueEmail('resend-invitation');
    const appTokenId = await seedValidInvitation(email);

    try {
      const response = await makeMetadataAPIRequest(
        resendWorkspaceInvitationOperationFactory({ appTokenId }),
      );

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.resendWorkspaceInvitation.success).toBe(true);

      const remainingTokens = await findWorkspaceInvitationsByEmail({ email });

      expect(remainingTokens).toHaveLength(1);
      expect(remainingTokens[0].value).not.toBe(`${email}-token`);
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email });
    }
  });

  it('rejects resending an unknown invitation', async () => {
    const response = await makeMetadataAPIRequest(
      resendWorkspaceInvitationOperationFactory({ appTokenId: v4() }),
    );

    expect(response.body.data).toBeNull();
    expect(response.body.errors[0].message).toBe('Invalid appToken');
  });

  it('refuses to invite someone who is already in the workspace', async () => {
    const email = uniqueEmail('existing-member');
    const [{ id: userId }] = await testDataSource.query(
      'INSERT INTO core."user" ("firstName", "lastName", "email") VALUES ($1, $2, $3) RETURNING "id"',
      ['Existing', 'Member', email],
    );

    await testDataSource.query(
      'INSERT INTO core."userWorkspace" ("userId", "workspaceId") VALUES ($1, $2)',
      [userId, SEED_APPLE_WORKSPACE_ID],
    );

    try {
      const response = await makeMetadataAPIRequest(
        sendInvitationsOperationFactory({ emails: [email] }),
      );

      expect(response.body.data.sendInvitations.success).toBe(false);
      expect(await findWorkspaceInvitationsByEmail({ email })).toHaveLength(0);
    } finally {
      await testDataSource.query(
        'DELETE FROM core."userWorkspace" WHERE "userId" = $1',
        [userId],
      );
      await testDataSource.query('DELETE FROM core."user" WHERE "id" = $1', [
        userId,
      ]);
    }
  });

  it('stores the requested role on the invitation', async () => {
    const email = uniqueEmail('role-invitation');

    const { data: rolesData } = await findRoles({
      expectToFail: false,
      gqlFields: 'id label',
    });
    const memberRole = rolesData?.getRoles.find(
      (role) => role.label === 'Member',
    );

    jestExpectToBeDefined(memberRole);

    try {
      const response = await makeMetadataAPIRequest(
        sendInvitationsOperationFactory({
          emails: [email],
          roleId: memberRole.id,
        }),
      );

      expect(response.body.data.sendInvitations.success).toBe(true);

      const listResponse = await makeMetadataAPIRequest(
        findWorkspaceInvitationsOperation,
      );

      expect(listResponse.body.data.findWorkspaceInvitations).toContainEqual(
        expect.objectContaining({ email, roleId: memberRole.id }),
      );
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email });
    }
  });

  it('denies sign-up when the email does not match the invitation', async () => {
    const invitedEmail = uniqueEmail('invited');
    const token = `${invitedEmail}-token`;

    await seedValidInvitation(invitedEmail);

    try {
      const response = await makeMetadataAPIRequest(
        signUpInWorkspaceOperationFactory({
          email: uniqueEmail('someone-else'),
          workspaceId: SEED_APPLE_WORKSPACE_ID,
          workspacePersonalInviteToken: token,
        }),
        null,
      );

      expect(response.body.data?.signUpInWorkspace).toBeFalsy();
      expectOneNotInternalServerErrorSnapshot({
        errors: response.body.errors,
      });
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email: invitedEmail });
    }
  });

  it('does not offer sign-up to an invited workspace the user already belongs to', async () => {
    await seedWorkspaceInvitation({
      email: JANE_EMAIL,
      value: `jane-invitation-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + ONE_HOUR_IN_MS),
    });

    try {
      const response = await makeMetadataAPIRequest(
        findSignUpWorkspacesOperation,
      );

      expect(response.body.errors).toBeUndefined();
      expect(
        response.body.data.currentUser.availableWorkspaces
          .availableWorkspacesForSignUp,
      ).not.toContainEqual({ id: SEED_APPLE_WORKSPACE_ID });
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email: JANE_EMAIL });
    }
  });

  it('rate limits repeated invitations to the same email', async () => {
    const email = uniqueEmail('throttled-invitation');
    const sendInvitation = () =>
      makeMetadataAPIRequest(
        sendInvitationsOperationFactory({ emails: [email] }),
      );

    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await sendInvitation();

        expect(response.body.errors).toBeUndefined();
      }

      const throttledResponse = await sendInvitation();

      expect(throttledResponse.body.data).toBeNull();
      expect(throttledResponse.body.errors[0].message).toBe(
        'Workspace invitation sending rate limit exceeded.',
      );
    } finally {
      await deleteWorkspaceInvitationsByEmail({ email });
    }
  });
});
