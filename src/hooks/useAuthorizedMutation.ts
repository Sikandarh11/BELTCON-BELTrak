import {
  useMutation,
  useQueryClient,
  type MutationFunction,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { authKeys } from "@/lib/queryKeys";
import { AppApiError } from "@/services/api/appApiError";

type AuthorizedMutationOptions<TData, TVariables, TContext> = Omit<
  UseMutationOptions<TData, AppApiError, TVariables, TContext>,
  "mutationFn" | "onError" | "onSuccess" | "retry"
> & {
  mutationFn: MutationFunction<TData, TVariables>;
  invalidate?: readonly (readonly unknown[])[];
  onError?: UseMutationOptions<TData, AppApiError, TVariables, TContext>["onError"];
  onSuccess?: UseMutationOptions<TData, AppApiError, TVariables, TContext>["onSuccess"];
};

/**
 * Consistent browser-side handling for already-authorized server mutations.
 * It never makes authorization decisions; server endpoints remain authority.
 */
export function useAuthorizedMutation<TData, TVariables, TContext = unknown>(
  options: AuthorizedMutationOptions<TData, TVariables, TContext>,
) {
  const queryClient = useQueryClient();

  return useMutation<TData, AppApiError, TVariables, TContext>({
    ...options,
    retry: false,
    mutationFn: options.mutationFn,
    onSuccess: async (data, variables, onMutateResult, context) => {
      for (const queryKey of options.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey });
      }
      await options.onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: async (error, variables, onMutateResult, context) => {
      // A 401/403 may reflect expiry, state transition, or a permission change.
      // Refresh session-derived navigation; preserve form values for retry.
      if (error.status === 401 || error.status === 403) {
        await queryClient.invalidateQueries({ queryKey: authKeys.all });
      }
      await options.onError?.(error, variables, onMutateResult, context);
    },
  });
}

export function authorizationErrorMessage(error: unknown) {
  if (!(error instanceof AppApiError)) {
    return error instanceof Error ? error.message : "The request could not be completed.";
  }

  switch (error.code) {
    case "ACCOUNT_INACTIVE":
      return "Your account is inactive. Contact an administrator.";
    case "ACCOUNT_SUSPENDED":
      return "Your account is suspended. Contact an administrator.";
    case "ACCOUNT_LOCKED":
      return "Your account is locked. Contact an administrator.";
    case "ACCOUNT_DEACTIVATED":
      return "Your account is deactivated. Contact an administrator.";
    case "ACCOUNT_PROFILE_MISSING":
      return "Your account is unavailable. Contact an administrator.";
    case "ROLE_PERMISSION_VERSION_CONFLICT":
    case "ADMIN_USER_VERSION_CONFLICT":
      return "This record was changed by another user. The latest data has been loaded.";
    case "PERMISSION_DENIED":
    case "PERMISSION_REQUIRED":
      return "You do not have permission to perform this action.";
    default:
      return error.message;
  }
}
