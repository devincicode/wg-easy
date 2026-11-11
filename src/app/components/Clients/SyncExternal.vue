<template>
  <BaseSecondaryButton
    :class="triggerClass"
    :disabled="syncing"
    @click="syncClients"
  >
    <LoaderCircleIcon v-if="syncing" class="size-4 animate-spin" />
    <RefreshCwIcon v-else class="size-4" />
    {{ $t('clients.syncExternal.title') }}
  </BaseSecondaryButton>
</template>

<script setup lang="ts">
import { LoaderCircleIcon, RefreshCwIcon } from '@lucide/vue';

import { $fetch } from '#imports';

defineProps<{ triggerClass?: string }>();

const clientsStore = useClientsStore();
const toast = useToast();
const { t } = useI18n();
const syncing = ref(false);

const _sync = useSubmit(
  () => $fetch('/api/client/sync-external', { method: 'post' }),
  {
    noSuccessToast: true,
    revert: async (success, res) => {
      if (success && res) {
        toast.showToast({
          type: 'success',
          message: t('clients.syncExternal.success', res),
        });
      }
      await clientsStore.refresh();
    },
  }
);

async function syncClients() {
  syncing.value = true;
  try {
    await _sync(undefined);
  } finally {
    syncing.value = false;
  }
}
</script>
