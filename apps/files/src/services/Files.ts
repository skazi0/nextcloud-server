/**
 * SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { ContentsWithRoot } from '@nextcloud/files'
import type { FileStat, ResponseDataDetailed } from 'webdav'

import { CancelablePromise } from 'cancelable-promise'
import { File, Folder, davGetDefaultPropfind, davResultToNode, davRootPath } from '@nextcloud/files'
import { client } from './WebdavClient.ts'
import logger from '../logger.js'

/**
 * Slim wrapper over `@nextcloud/files` `davResultToNode` to allow using the function with `Array.map`
 * @param node The node returned by the webdav library
 */
export const resultToNode = (node: FileStat): File | Folder => {
	// TODO remove this hack with nextcloud-files v3.7
	// just needed because of a bug in the webdav client
	if (node.props?.displayname !== undefined) {
		node.props.displayname = String(node.props.displayname)
	}
	return davResultToNode(node)
}

export const getContents = (path = '/'): CancelablePromise<ContentsWithRoot> => {
	const controller = new AbortController()
	const propfindPayload = davGetDefaultPropfind()

	path = `${davRootPath}${path}`

	return new CancelablePromise(async (resolve, reject, onCancel) => {
		onCancel(() => controller.abort())
		try {
			const contentsResponse = await client.getDirectoryContents(path, {
				details: true,
				data: propfindPayload,
				includeSelf: true,
				signal: controller.signal,
			}) as ResponseDataDetailed<FileStat[]>

			const root = contentsResponse.data[0]
			const contents = contentsResponse.data.slice(1)
			if (root.filename !== path && `${root.filename}/` !== path) {
				logger.debug(`Exepected "${path}" but got filename "${root.filename}" instead.`)
				throw new Error('Root node does not match requested path')
			}

			resolve({
				folder: resultToNode(root) as Folder,
				contents: contents.map((result) => {
					try {
						return resultToNode(result)
					} catch (error) {
						logger.error(`Invalid node detected '${result.basename}'`, { error })
						return null
					}
				}).filter(Boolean) as File[],
			})
		} catch (error) {
			reject(error)
		}
	})
}
